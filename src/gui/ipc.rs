use crate::keyfinder;
use crate::rpf::{self, ArchiveInfo, Entry, Key, Kind, Rpf, Version};
use rayon::prelude::*;
use serde::Serialize;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;

const PREVIEW_LIMIT: usize = 64 * 1024 * 1024;
const TEXT_PREVIEW_LIMIT: usize = 2 * 1024 * 1024;
const RESULT_LIMIT: usize = 1000;

#[derive(Clone, Copy, PartialEq, Eq)]
enum GameId {
    MaxPayne3,
    GtaIv,
    GtaV,
    RedDeadRedemption,
    RedDeadRedemption2,
}

#[derive(Default)]
pub struct ExplorerState {
    inner: Mutex<ExplorerData>,
    indexed: AtomicUsize,
}

#[derive(Default)]
struct ExplorerData {
    game_id: Option<String>,
    game_name: String,
    root: PathBuf,
    key: Option<Key>,
    gtav_keys: Option<Arc<rpf_archive::GtaKeys>>,
    slots: Vec<Arc<ArchiveSlot>>,
    status: String,
}

struct ArchiveSlot {
    path: PathBuf,
    cache: Mutex<Option<Result<Arc<Rpf>, String>>>,
    rdr2: bool,
    rdr2_filesystem: Option<Arc<rf_formats::rpf8::Rpf8FileSystem>>,
    rdr2_index: Option<usize>,
}

impl ArchiveSlot {
    fn get(
        &self,
        key: &Key,
        gtav_keys: Option<&Arc<rpf_archive::GtaKeys>>,
    ) -> Result<Arc<Rpf>, String> {
        let mut cache = self
            .cache
            .lock()
            .map_err(|_| "Archive cache is unavailable")?;
        if cache.is_none() {
            let result = if self.rdr2 {
                match (&self.rdr2_filesystem, self.rdr2_index) {
                    (Some(filesystem), Some(index)) => {
                        Rpf::from_rdr2(filesystem.clone(), index).map(Arc::new)
                    }
                    _ => Err("RPF8 archive was not initialized".to_owned()),
                }
            } else if let Some(keys) = gtav_keys {
                Rpf::open_gtav(&self.path, Some(keys.clone())).map(Arc::new)
            } else {
                Rpf::open(&self.path, key).map(Arc::new)
            };
            *cache = Some(result);
        }
        cache.as_ref().unwrap().clone()
    }

    fn peek(&self) -> Option<Result<Arc<Rpf>, String>> {
        self.cache.lock().ok()?.as_ref().cloned()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    game_id: Option<String>,
    game_name: String,
    root: String,
    status: String,
    archives: Vec<ArchiveSummary>,
    indexed: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveSummary {
    index: usize,
    path: String,
    loaded: bool,
    entry_count: Option<usize>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveContent {
    index: usize,
    path: String,
    version: String,
    entries: Vec<EntrySummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EntrySummary {
    index: usize,
    parent: Option<usize>,
    depth: usize,
    name: String,
    path: String,
    is_dir: bool,
    size: u32,
    stored: u32,
    offset: u64,
    compressed: bool,
    resource: bool,
    encrypted: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    name: String,
    kind: String,
    content: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct IndexProgress {
    completed: usize,
    total: usize,
    matches: usize,
    failed: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    archive_index: usize,
    entry_index: usize,
    archive: String,
    name: String,
    path: String,
    size: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexResponse {
    results: Vec<SearchResult>,
    skipped_archives: usize,
}

#[tauri::command]
pub fn choose_game_folder(
    app: AppHandle,
    state: State<'_, ExplorerState>,
    game_id: String,
    key_input: Option<String>,
) -> Result<Summary, String> {
    let (game, game_name) = game_by_id(&game_id)?;
    let Some(folder) = app.dialog().file().blocking_pick_folder() else {
        return Err("Folder selection cancelled.".into());
    };
    let folder = folder
        .into_path()
        .map_err(|error| format!("Invalid selected folder: {error}"))?;
    if !folder.is_dir() {
        return Err("The selected path is not a folder.".into());
    }
    let supplied_key = key_input.as_deref().and_then(keyfinder::parse_hex);
    if key_input
        .as_ref()
        .is_some_and(|value| !value.trim().is_empty())
        && supplied_key.is_none()
    {
        return Err("Enter a 64-character hexadecimal AES key.".into());
    }
    state.indexed.store(0, Ordering::Relaxed);
    let mut data = load_game(folder, game, game_name, supplied_key)?;
    data.game_id = Some(game_id);
    let summary = summary_from_data(&data, 0);
    *state
        .inner
        .lock()
        .map_err(|_| "Application state is unavailable")? = data;
    Ok(summary)
}

#[tauri::command]
pub fn get_summary(state: State<'_, ExplorerState>) -> Result<Summary, String> {
    let data = state
        .inner
        .lock()
        .map_err(|_| "Application state is unavailable")?;
    Ok(summary_from_data(
        &data,
        state.indexed.load(Ordering::Relaxed),
    ))
}

#[tauri::command]
pub fn open_archive(
    state: State<'_, ExplorerState>,
    archive_index: usize,
) -> Result<ArchiveContent, String> {
    let data = state
        .inner
        .lock()
        .map_err(|_| "Application state is unavailable")?;
    let slot = data.slots.get(archive_index).ok_or("Archive not found")?;
    let key = data.key.ok_or("No archive key is available")?;
    let rpf = if let Some(result) = slot.peek() {
        result?
    } else {
        slot.get(&key, data.gtav_keys.as_ref())?
    };
    let mut entries = Vec::new();
    append_entries(&rpf.entries, 0, None, 0, "", &mut entries);
    Ok(ArchiveContent {
        index: archive_index,
        path: relative(&data.root, &slot.path),
        version: format!("{:?}", rpf.version).to_uppercase(),
        entries,
    })
}

#[tauri::command]
pub fn preview_entry(
    state: State<'_, ExplorerState>,
    archive_index: usize,
    entry_index: usize,
) -> Result<Preview, String> {
    let data = state
        .inner
        .lock()
        .map_err(|_| "Application state is unavailable")?;
    let (rpf, entry) = get_entry(&data, archive_index, entry_index)?;
    if entry.is_dir() {
        return Err("Folders do not have a preview.".into());
    }
    let name = entry.name.clone();
    let extension = extension(&name);
    if is_text(&extension) {
        if entry.size() as usize > TEXT_PREVIEW_LIMIT {
            return Ok(Preview {
                name,
                kind: "note".into(),
                content: Some("Text preview is limited to 2 MiB.".into()),
            });
        }
        let bytes = rpf
            .read_file(entry_index)
            .map_err(|error| error.to_string())?;
        let mut text = String::from_utf8_lossy(&bytes).into_owned();
        if text.chars().count() > 12_000 {
            text = text.chars().take(12_000).collect::<String>() + "\n… Preview truncated";
        }
        return Ok(Preview {
            name,
            kind: "text".into(),
            content: Some(text),
        });
    }
    if is_image(&extension) {
        if entry.size() as usize > PREVIEW_LIMIT {
            return Ok(Preview {
                name,
                kind: "note".into(),
                content: Some("Image preview is limited to 64 MiB.".into()),
            });
        }
        let bytes = rpf
            .read_file(entry_index)
            .map_err(|error| error.to_string())?;
        let (mime, preview_bytes) = encode_image(&name, &bytes)?;
        return Ok(Preview {
            name,
            kind: "image".into(),
            content: Some(format!(
                "data:image/{};base64,{}",
                mime,
                base64::Engine::encode(&base64::engine::general_purpose::STANDARD, preview_bytes)
            )),
        });
    }
    let resource = matches!(entry.kind, Kind::File { resource: true, .. });
    let note = if resource
        || matches!(
            extension.as_str(),
            "wdr" | "wft" | "wtd" | "ydr" | "ydd" | "yft"
        ) {
        "3D/resource preview is not available. Extract the original file to inspect it with a compatible tool."
    } else {
        "No preview is available for this file type. You can still extract the original file."
    };
    Ok(Preview {
        name,
        kind: "note".into(),
        content: Some(note.into()),
    })
}

#[tauri::command]
pub fn extract_file(
    app: AppHandle,
    state: State<'_, ExplorerState>,
    archive_index: usize,
    entry_index: usize,
) -> Result<String, String> {
    let Some(folder) = app.dialog().file().blocking_pick_folder() else {
        return Err("Extraction cancelled.".into());
    };
    let folder = folder
        .into_path()
        .map_err(|error| format!("Invalid selected folder: {error}"))?;
    let data = state
        .inner
        .lock()
        .map_err(|_| "Application state is unavailable")?;
    let (rpf, entry) = get_entry(&data, archive_index, entry_index)?;
    if entry.is_dir() {
        return Err("Select a file to extract.".into());
    }
    let name = safe_file_name(&entry.name)?;
    let output = folder.join(name);
    rpf.read_file(entry_index)
        .and_then(|bytes| std::fs::write(&output, bytes))
        .map_err(|error| format!("Could not extract file: {error}"))?;
    Ok(format!("Extracted {}", output.display()))
}

#[tauri::command]
pub fn extract_folder(
    app: AppHandle,
    state: State<'_, ExplorerState>,
    archive_index: usize,
    entry_index: usize,
) -> Result<String, String> {
    let Some(folder) = app.dialog().file().blocking_pick_folder() else {
        return Err("Extraction cancelled.".into());
    };
    let folder = folder
        .into_path()
        .map_err(|error| format!("Invalid selected folder: {error}"))?;
    let data = state
        .inner
        .lock()
        .map_err(|_| "Application state is unavailable")?;
    let (rpf, entry) = get_entry(&data, archive_index, entry_index)?;
    if !entry.is_dir() {
        return Err("Select a folder to extract.".into());
    }
    let count = rpf
        .extract(entry_index, &folder)
        .map_err(|error| format!("Could not extract folder: {error}"))?;
    Ok(format!("Extracted {count} files to {}", folder.display()))
}

#[tauri::command]
pub fn index_archives(
    app: AppHandle,
    state: State<'_, ExplorerState>,
    query: String,
) -> Result<IndexResponse, String> {
    let query = query.trim().to_ascii_lowercase();
    let (slots, key, gtav_keys, root) = {
        let data = state
            .inner
            .lock()
            .map_err(|_| "Application state is unavailable")?;
        (
            data.slots.clone(),
            data.key.ok_or("No archives are loaded")?,
            data.gtav_keys.clone(),
            data.root.clone(),
        )
    };
    state.indexed.store(0, Ordering::Relaxed);
    let mut results = Vec::new();
    let mut skipped_archives = 0;
    let total = slots.len();
    for (archive_index, slot) in slots.iter().enumerate() {
        match slot.get(&key, gtav_keys.as_ref()) {
            Ok(rpf) => {
                let parents = build_parent_indices(&rpf.entries);
                let archive_path = relative(&root, &slot.path);
                for (entry_index, entry) in rpf.entries.iter().enumerate() {
                    if entry.is_dir()
                        || (!query.is_empty()
                            && !contains_ascii_case_insensitive(&entry.name, &query))
                    {
                        continue;
                    }
                    results.push(SearchResult {
                        archive_index,
                        entry_index,
                        archive: archive_path.clone(),
                        name: entry.name.clone(),
                        path: entry_full_path(&rpf.entries, &parents, entry_index),
                        size: entry.size(),
                    });
                    if results.len() == RESULT_LIMIT {
                        break;
                    }
                }
            }
            Err(_) => skipped_archives += 1,
        }
        state.indexed.store(archive_index + 1, Ordering::Relaxed);
        let _ = app.emit(
            "index-progress",
            IndexProgress {
                completed: archive_index + 1,
                total,
                matches: results.len(),
                failed: skipped_archives,
            },
        );
        if results.len() == RESULT_LIMIT {
            break;
        }
    }
    Ok(IndexResponse {
        results,
        skipped_archives,
    })
}

fn game_by_id(id: &str) -> Result<(GameId, &'static str), String> {
    match id {
        "max-payne-3" => Ok((GameId::MaxPayne3, "Max Payne 3")),
        "gta-iv" => Ok((GameId::GtaIv, "GTA IV")),
        "gta-v" => Ok((GameId::GtaV, "GTA V")),
        "rdr1" => Ok((GameId::RedDeadRedemption, "Red Dead Redemption")),
        "rdr2" => Ok((GameId::RedDeadRedemption2, "Red Dead Redemption 2")),
        _ => Err("Unsupported game selection.".into()),
    }
}

fn load_game(
    folder: PathBuf,
    game: GameId,
    game_name: &str,
    supplied_key: Option<Key>,
) -> Result<ExplorerData, String> {
    if game == GameId::RedDeadRedemption2 {
        return load_rdr2(folder, game_name);
    }
    let mut archives = Vec::new();
    let mut executables = Vec::new();
    for entry in walkdir::WalkDir::new(&folder)
        .into_iter()
        .flatten()
        .filter(|entry| entry.file_type().is_file())
    {
        let path = entry.into_path();
        if path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("rpf"))
        {
            archives.push(path);
        } else if (game == GameId::GtaV || supplied_key.is_none())
            && path
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
        {
            executables.push(path);
        }
    }
    archives.sort();
    executables.sort();
    if game == GameId::GtaV {
        executables.sort_by_key(|path| {
            !path
                .file_name()
                .is_some_and(|name| name.eq_ignore_ascii_case("GTA5.exe"))
        });
    }
    if archives.is_empty() {
        return Err("No .rpf files found.".into());
    }
    let supported = archives
        .into_par_iter()
        .filter_map(|path| {
            let info = rpf::inspect(&path).ok()?;
            let matches = match game {
                GameId::MaxPayne3 => info.version == Version::Rpf4,
                GameId::GtaIv => matches!(info.version, Version::Rpf2 | Version::Rpf3),
                GameId::GtaV => info.version == Version::Rpf7,
                GameId::RedDeadRedemption => info.version == Version::Rpf6,
                GameId::RedDeadRedemption2 => false,
            };
            matches.then_some((path, info))
        })
        .collect::<Vec<_>>();
    if supported.is_empty() {
        return Err("No archives of the selected format were found in this folder.".into());
    }
    let gtav_keys = if game == GameId::GtaV {
        Some(Arc::new(
            executables
                .iter()
                .find_map(|exe| rpf_archive::GtaKeys::extract_from_exe(exe, None).ok())
                .ok_or("Could not find GTA V keys in the executables in the selected folder.")?,
        ))
    } else {
        None
    };
    let encrypted = supported.iter().find(|(_, info)| info.toc_encrypted);
    let key = if game == GameId::GtaV {
        [0; 32]
    } else if let Some((_, info)) = encrypted {
        if let Some(key) = supplied_key {
            if !keyfinder::validate_archive_key(&key, info) {
                return Err("The supplied AES key does not match this archive.".into());
            }
            key
        } else {
            find_key(info, &executables)?
        }
    } else {
        supplied_key.unwrap_or([0; 32])
    };
    let slots = supported
        .into_iter()
        .map(|(path, _)| {
            Arc::new(ArchiveSlot {
                path,
                cache: Mutex::new(None),
                rdr2: false,
                rdr2_filesystem: None,
                rdr2_index: None,
            })
        })
        .collect::<Vec<_>>();
    Ok(ExplorerData {
        game_id: None,
        game_name: game_name.into(),
        root: folder,
        key: Some(key),
        gtav_keys,
        status: format!(
            "{} supported archives found. Archives open on selection.",
            slots.len()
        ),
        slots,
    })
}

fn load_rdr2(folder: PathBuf, game_name: &str) -> Result<ExplorerData, String> {
    let keys = rf_formats::rpf8::Rpf8Keys::from_game_folder(&folder)
        .map_err(|error| format!("RDR2 keys unavailable: {error}"))?;
    let strings = rf_formats::hash::HashIndex::new();
    let filesystem = Arc::new(
        rf_formats::rpf8::Rpf8FileSystem::open(&folder, keys, &strings)
            .map_err(|error| format!("Could not open RPF8 archives: {error}"))?,
    );
    if filesystem.archives.is_empty() {
        return Err("No valid RPF8 archives were found.".into());
    }
    let slots = filesystem
        .archives
        .iter()
        .enumerate()
        .map(|(index, archive)| {
            Arc::new(ArchiveSlot {
                path: folder.join(&archive.path),
                cache: Mutex::new(None),
                rdr2: true,
                rdr2_filesystem: Some(filesystem.clone()),
                rdr2_index: Some(index),
            })
        })
        .collect::<Vec<_>>();
    if slots.is_empty() {
        return Err("No usable RPF8 archives were found.".into());
    }
    let warning = if filesystem.errors.is_empty() {
        String::new()
    } else {
        format!(" {} archive(s) could not be read.", filesystem.errors.len())
    };
    Ok(ExplorerData {
        game_id: None,
        game_name: game_name.into(),
        root: folder,
        key: Some([0; 32]),
        gtav_keys: None,
        status: format!(
            "{} RPF8 archives loaded. Hashed names appear in hexadecimal.{warning}",
            slots.len()
        ),
        slots,
    })
}

fn find_key(info: &ArchiveInfo, executables: &[PathBuf]) -> Result<Key, String> {
    let cache_path = std::env::current_dir()
        .unwrap_or_default()
        .join("rpf_explorer_keys.txt");
    let cache = std::fs::read_to_string(&cache_path).unwrap_or_default();
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(
            (std::thread::available_parallelism()
                .map(|count| count.get())
                .unwrap_or(2)
                / 2)
            .max(1),
        )
        .build()
        .map_err(|error| error.to_string())?;
    for exe in executables {
        let tag = format!(
            "rpf{:?} {} {}",
            info.version,
            std::fs::metadata(exe)
                .map(|metadata| metadata.len())
                .unwrap_or_default(),
            exe.canonicalize().unwrap_or_else(|_| exe.clone()).display()
        );
        if let Some(key) = cache
            .lines()
            .filter_map(|line| {
                line.strip_prefix(&format!("{tag} "))
                    .and_then(keyfinder::parse_hex)
                    .or_else(|| {
                        line.split_whitespace()
                            .last()
                            .and_then(keyfinder::parse_hex)
                    })
            })
            .find(|key| keyfinder::validate_archive_key(key, info))
        {
            return Ok(key);
        }
        let file = std::fs::File::open(exe)
            .map_err(|error| format!("Could not read {}: {error}", exe.display()))?;
        let map = unsafe { memmap2::Mmap::map(&file) }
            .map_err(|error| format!("Could not map {}: {error}", exe.display()))?;
        if let Some((key, _)) = pool.install(|| keyfinder::find_key_for_archive(&map, info)) {
            if let Err(_error) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&cache_path)
                .and_then(|mut file| writeln!(file, "{tag} {}", keyfinder::hex(&key)))
            {}
            return Ok(key);
        }
    }
    Err(if executables.is_empty() {
        "No executable files were found to search for the AES key. Provide a 64-character hexadecimal key.".into()
    } else {
        "AES key not found. Provide a 64-character hexadecimal key.".into()
    })
}

fn summary_from_data(data: &ExplorerData, indexed: usize) -> Summary {
    let archives = data
        .slots
        .iter()
        .enumerate()
        .map(|(index, slot)| match slot.peek() {
            Some(Ok(rpf)) => ArchiveSummary {
                index,
                path: relative(&data.root, &slot.path),
                loaded: true,
                entry_count: Some(rpf.entries.len()),
                error: None,
            },
            Some(Err(error)) => ArchiveSummary {
                index,
                path: relative(&data.root, &slot.path),
                loaded: false,
                entry_count: None,
                error: Some(error),
            },
            None => ArchiveSummary {
                index,
                path: relative(&data.root, &slot.path),
                loaded: false,
                entry_count: None,
                error: None,
            },
        })
        .collect();
    Summary {
        game_id: data.game_id.clone(),
        game_name: data.game_name.clone(),
        root: data.root.to_string_lossy().into_owned(),
        status: data.status.clone(),
        archives,
        indexed,
    }
}

fn get_entry(
    data: &ExplorerData,
    archive_index: usize,
    entry_index: usize,
) -> Result<(Arc<Rpf>, Entry), String> {
    let slot = data.slots.get(archive_index).ok_or("Archive not found")?;
    let rpf = if let Some(result) = slot.peek() {
        result?
    } else {
        slot.get(
            &data.key.ok_or("No archive key is available")?,
            data.gtav_keys.as_ref(),
        )?
    };
    let entry = rpf
        .entries
        .get(entry_index)
        .ok_or("Entry not found")?
        .clone();
    Ok((rpf, entry))
}

fn append_entries(
    entries: &[Entry],
    index: usize,
    parent: Option<usize>,
    depth: usize,
    prefix: &str,
    output: &mut Vec<EntrySummary>,
) {
    let Some(entry) = entries.get(index) else {
        return;
    };
    let path = if index == 0 {
        String::new()
    } else if prefix.is_empty() {
        entry.name.clone()
    } else {
        format!("{prefix}/{}", entry.name)
    };
    let (stored, offset, compressed, resource, encrypted) = match entry.kind {
        Kind::File {
            stored,
            offset,
            compressed,
            resource,
            encrypted,
            ..
        } => (stored, offset, compressed, resource, encrypted),
        Kind::Dir { .. } => (0, 0, false, false, false),
    };
    output.push(EntrySummary {
        index,
        parent,
        depth,
        name: entry.name.clone(),
        path: path.clone(),
        is_dir: entry.is_dir(),
        size: entry.size(),
        stored,
        offset,
        compressed,
        resource,
        encrypted,
    });
    if let Kind::Dir { kids } = &entry.kind {
        for &child in kids {
            append_entries(
                entries,
                child as usize,
                Some(index),
                depth + 1,
                &path,
                output,
            );
        }
    }
}

fn build_parent_indices(entries: &[Entry]) -> Vec<Option<usize>> {
    let mut parents = vec![None; entries.len()];
    for (parent, entry) in entries.iter().enumerate() {
        if let Kind::Dir { kids } = &entry.kind {
            for &child in kids {
                if let Some(parent_index) = parents.get_mut(child as usize) {
                    *parent_index = Some(parent);
                }
            }
        }
    }
    parents
}

fn entry_full_path(entries: &[Entry], parents: &[Option<usize>], index: usize) -> String {
    let mut parts = Vec::new();
    let mut current = index;
    while let Some(entry) = entries.get(current) {
        if current == 0 {
            break;
        }
        parts.push(entry.name.clone());
        current = parents.get(current).copied().flatten().unwrap_or(0);
    }
    parts.reverse();
    parts.join("/")
}

fn contains_ascii_case_insensitive(value: &str, query: &str) -> bool {
    query.is_empty()
        || value
            .as_bytes()
            .windows(query.len())
            .any(|window| window.eq_ignore_ascii_case(query.as_bytes()))
}

fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn safe_file_name(name: &str) -> Result<&str, String> {
    let path = Path::new(name);
    if path.components().count() != 1
        || path.file_name().and_then(|part| part.to_str()) != Some(name)
    {
        return Err("The archive entry has an unsafe file name.".into());
    }
    Ok(name)
}

fn extension(name: &str) -> String {
    name.rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .unwrap_or_default()
}

fn is_text(ext: &str) -> bool {
    matches!(
        ext,
        "csv"
            | "xml"
            | "txt"
            | "dat"
            | "ide"
            | "ipl"
            | "cfg"
            | "meta"
            | "ini"
            | "fx"
            | "lua"
            | "json"
    )
}

fn is_image(ext: &str) -> bool {
    matches!(ext, "dds" | "png" | "jpg" | "jpeg")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn archive_paths_use_precomputed_parents() {
        let entries = vec![
            Entry {
                name: String::new(),
                kind: Kind::Dir { kids: vec![1] },
            },
            Entry {
                name: "textures".into(),
                kind: Kind::Dir { kids: vec![2] },
            },
            Entry {
                name: "road.dds".into(),
                kind: Kind::File {
                    offset: 0,
                    size: 0,
                    stored: 0,
                    compressed: false,
                    resource: false,
                    encrypted: false,
                },
            },
        ];
        let parents = build_parent_indices(&entries);
        assert_eq!(entry_full_path(&entries, &parents, 2), "textures/road.dds");
    }

    #[test]
    fn filename_search_is_ascii_case_insensitive() {
        assert!(contains_ascii_case_insensitive("Road.DDS", "road"));
        assert!(!contains_ascii_case_insensitive("Road.DDS", "roads"));
        assert!(contains_ascii_case_insensitive("Road.DDS", ""));
    }
}

fn encode_image(name: &str, bytes: &[u8]) -> Result<(&'static str, Vec<u8>), String> {
    if bytes.len() > PREVIEW_LIMIT {
        return Err("Image preview is limited to 64 MiB.".into());
    }
    if extension(name) == "dds" {
        let dds = ddsfile::Dds::read(&mut std::io::Cursor::new(bytes))
            .map_err(|error| format!("Invalid or unreadable DDS: {error}"))?;
        if dds.get_width() > 8192
            || dds.get_height() > 8192
            || u64::from(dds.get_width()) * u64::from(dds.get_height()) > 16 * 1024 * 1024
        {
            return Err("Unsupported image dimensions.".into());
        }
        let image = image_dds::image_from_dds(&dds, 0)
            .map_err(|error| format!("Could not decode DDS: {error}"))?;
        let mut output = std::io::Cursor::new(Vec::new());
        image
            .write_to(&mut output, image::ImageFormat::Png)
            .map_err(|error| format!("Could not encode DDS preview: {error}"))?;
        return Ok(("png", output.into_inner()));
    } else {
        let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes))
            .with_guessed_format()
            .map_err(|error| error.to_string())?;
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(8192);
        limits.max_image_height = Some(8192);
        limits.max_alloc = Some(PREVIEW_LIMIT as u64);
        reader.limits(limits);
        let decoded = reader
            .decode()
            .map_err(|error| format!("Could not decode image: {error}"))?;
        let (width, height) = (decoded.width(), decoded.height());
        if width == 0
            || height == 0
            || width > 8192
            || height > 8192
            || u64::from(width) * u64::from(height) > 16 * 1024 * 1024
        {
            return Err(format!("Unsupported image dimensions: {width} × {height}."));
        }
    }
    let mime = match extension(name).as_str() {
        "jpg" | "jpeg" => "jpeg",
        "png" => "png",
        _ => return Err("Unsupported image format.".into()),
    };
    Ok((mime, bytes.to_vec()))
}
