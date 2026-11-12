use crate::rpf::{self, Entry, Key, Kind, Rpf};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tauri::State;

pub mod archive;
pub mod game;
pub(super) mod keys;
pub(super) mod model_assets;
pub mod nested;
pub mod preview;
pub mod search;

const PREVIEW_LIMIT: usize = 64 * 1024 * 1024;
const TEXT_PREVIEW_LIMIT: usize = 2 * 1024 * 1024;
const MODEL_PREVIEW_LIMIT: usize = 32 * 1024 * 1024;
const MODEL_ASSET_LIMIT: usize = 8 * 1024 * 1024;
const MODEL_ASSET_BUNDLE_LIMIT: usize = 16 * 1024 * 1024;
const NESTED_ARCHIVE_LIMIT: usize = 512 * 1024 * 1024;
const MODEL_ASSET_COUNT_LIMIT: usize = 32;
const RESULT_LIMIT: usize = 1000;
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
    root_slot_count: usize,
    status: String,
}

struct ArchiveSlot {
    path: PathBuf,
    display_path: Option<String>,
    cache: Mutex<Option<Result<Arc<Rpf>, String>>>,
    rdr2: bool,
    requires_gtav: bool,
    rdr2_filesystem: Option<Arc<rf_formats::rpf8::Rpf8FileSystem>>,
    rdr2_index: Option<usize>,
    _temporary_file: Option<Arc<TemporaryArchiveFile>>,
}

struct TemporaryArchiveFile(PathBuf);

impl Drop for TemporaryArchiveFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
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
            } else if self.requires_gtav {
                match gtav_keys {
                    Some(keys) => Rpf::open_gtav(&self.path, Some(keys.clone())).map(Arc::new),
                    None => Err("GTA V archive keys are unavailable".to_owned()),
                }
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
pub struct GameDirectoryEntry {
    name: String,
    path: String,
    is_dir: bool,
    is_archive: bool,
    size: u64,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelAsset {
    path: String,
    data: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GenericModelPayload {
    format: String,
    data: String,
    assets: Vec<ModelAsset>,
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

fn summary_from_data(data: &ExplorerData, indexed: usize) -> Summary {
    let archives = data
        .slots
        .iter()
        .take(data.root_slot_count)
        .enumerate()
        .map(|(index, slot)| match slot.peek() {
            Some(Ok(rpf)) => ArchiveSummary {
                index,
                path: archive_display_path(data, slot),
                loaded: true,
                entry_count: Some(rpf.entries.len()),
                error: None,
            },
            Some(Err(error)) => ArchiveSummary {
                index,
                path: archive_display_path(data, slot),
                loaded: false,
                entry_count: None,
                error: Some(error),
            },
            None => ArchiveSummary {
                index,
                path: archive_display_path(data, slot),
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

fn archive_display_path(data: &ExplorerData, slot: &ArchiveSlot) -> String {
    slot.display_path
        .clone()
        .unwrap_or_else(|| relative(&data.root, &slot.path))
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

    #[test]
    fn model_asset_references_reject_external_and_traversal_paths() {
        assert_eq!(
            model_assets::resolve_model_reference("", "textures/albedo%20map.png").as_deref(),
            Some("textures/albedo map.png")
        );
        assert_eq!(
            model_assets::resolve_model_reference("", "./textures/albedo.png").as_deref(),
            Some("textures/albedo.png")
        );
        assert_eq!(
            model_assets::resolve_model_reference("materials/car.mtl", "../outside.png"),
            None
        );
        assert_eq!(
            model_assets::resolve_model_reference("", "https://example.invalid/texture.png"),
            None
        );
        assert_eq!(
            model_assets::resolve_model_reference("", "%2e%2e/outside.png"),
            None
        );
        assert_eq!(
            model_assets::resolve_model_reference("", "C%3a/outside.png"),
            None
        );
    }

    #[test]
    fn glb_dependency_scan_reads_only_the_json_chunk() {
        let json = br#"{"buffers":[{"uri":"mesh.bin"}],"images":[{"uri":"tex.png"}]}"#;
        let padding = (4 - json.len() % 4) % 4;
        let mut glb = Vec::new();
        glb.extend_from_slice(b"glTF");
        glb.extend_from_slice(&2u32.to_le_bytes());
        glb.extend_from_slice(&((20 + json.len() + padding) as u32).to_le_bytes());
        glb.extend_from_slice(&((json.len() + padding) as u32).to_le_bytes());
        glb.extend_from_slice(&0x4E4F534Au32.to_le_bytes());
        glb.extend_from_slice(json);
        glb.resize(glb.len() + padding, b' ');
        assert_eq!(
            model_assets::model_asset_references("glb", &glb),
            ["mesh.bin".to_owned(), "tex.png".to_owned()]
        );
    }
}
