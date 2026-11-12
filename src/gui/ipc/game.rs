use super::keys::{extract_gtav_keys, find_key};
use super::*;
use crate::keyfinder;
use crate::rpf::Version;
use rayon::prelude::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Clone, Copy, PartialEq, Eq)]
enum GameId {
    MaxPayne3,
    GtaIv,
    GtaV,
    RedDeadRedemption,
    RedDeadRedemption2,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GameLoadProgress {
    game_id: String,
    stage: String,
    message: String,
    completed: usize,
    total: usize,
    progress: Option<u8>,
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
    let cache_dir = if game == GameId::GtaV {
        Some(
            app.path()
                .app_cache_dir()
                .map_err(|error| format!("Could not access the application cache: {error}"))?
                .join("gtav-keys"),
        )
    } else {
        None
    };
    let mut data = load_game(
        folder,
        game,
        game_name,
        supplied_key,
        &app,
        &game_id,
        cache_dir.as_deref(),
    )?;
    data.game_id = Some(game_id);
    let summary = summary_from_data(&data, 0);
    *state
        .inner
        .lock()
        .map_err(|_| "Application state is unavailable")? = data;
    Ok(summary)
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
    app: &AppHandle,
    game_id: &str,
    gtav_key_cache: Option<&Path>,
) -> Result<ExplorerData, String> {
    if game == GameId::RedDeadRedemption2 {
        emit_game_load_progress(
            app,
            game_id,
            "opening",
            "Opening the game archives…",
            0,
            0,
            None,
        );
        return load_rdr2(folder, game_name);
    }
    emit_game_load_progress(
        app,
        game_id,
        "scanning",
        "Scanning the game folder…",
        0,
        0,
        None,
    );
    let mut archives = Vec::new();
    let mut executables = Vec::new();
    let mut visited = 0usize;
    for entry in walkdir::WalkDir::new(&folder)
        .into_iter()
        .flatten()
        .filter(|entry| entry.file_type().is_file())
    {
        visited += 1;
        if visited.is_multiple_of(512) {
            emit_game_load_progress(
                app,
                game_id,
                "scanning",
                &format!("Scanning game files… {visited} checked"),
                visited,
                0,
                None,
            );
        }
        let path = entry.into_path();
        if path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("rpf"))
        {
            archives.push(path);
        } else if path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
            && ((game == GameId::GtaV && is_gtav_executable(&path))
                || (game != GameId::GtaV && supplied_key.is_none()))
        {
            executables.push(path);
        }
    }
    if visited > 0 {
        emit_game_load_progress(
            app,
            game_id,
            "scanning",
            &format!("Found {} RPF archives", archives.len()),
            visited,
            visited,
            Some(30),
        );
    }
    archives.sort();
    executables.sort();
    if game == GameId::GtaV {
        executables.sort_by_key(|path| {
            !path.file_name().is_some_and(|name| {
                name.to_string_lossy()
                    .eq_ignore_ascii_case("GTA5_Enhanced.exe")
            })
        });
    }
    if archives.is_empty() {
        return Err("No .rpf files found.".into());
    }
    let archive_total = archives.len();
    emit_game_load_progress(
        app,
        game_id,
        "archives",
        &format!("Checking {archive_total} RPF archives…"),
        0,
        archive_total,
        Some(30),
    );
    let inspected = AtomicUsize::new(0);
    let supported = archives
        .into_par_iter()
        .filter_map(|path| {
            let completed = inspected.fetch_add(1, Ordering::Relaxed) + 1;
            if completed == archive_total || completed.is_multiple_of((archive_total / 80).max(1)) {
                emit_game_load_progress(
                    app,
                    game_id,
                    "archives",
                    &format!("Checking RPF archives… {completed} of {archive_total}"),
                    completed,
                    archive_total,
                    Some(30 + (completed * 45 / archive_total.max(1)) as u8),
                );
            }
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
        emit_game_load_progress(
            app,
            game_id,
            "keys",
            "Loading GTA V encryption keys…",
            0,
            0,
            None,
        );
        let executable = executables
            .first()
            .ok_or("Could not find GTA5.exe or GTA5_Enhanced.exe in the selected game folder.")?;
        Some(Arc::new(extract_gtav_keys(
            executable,
            gtav_key_cache.ok_or("GTA V key cache is unavailable")?,
            app,
            game_id,
        )?))
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
            emit_game_load_progress(
                app,
                game_id,
                "keys",
                "Searching game files for archive keys…",
                0,
                0,
                None,
            );
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
                display_path: None,
                _temporary_file: None,
                cache: Mutex::new(None),
                rdr2: false,
                requires_gtav: game == GameId::GtaV,
                rdr2_filesystem: None,
                rdr2_index: None,
            })
        })
        .collect::<Vec<_>>();
    let root_slot_count = slots.len();
    emit_game_load_progress(app, game_id, "ready", "Finishing setup…", 1, 1, Some(100));
    Ok(ExplorerData {
        game_id: None,
        game_name: game_name.into(),
        root: folder,
        key: Some(key),
        gtav_keys,
        root_slot_count,
        status: format!(
            "{} supported archives found. Archives open on selection.",
            slots.len()
        ),
        slots,
    })
}

fn is_gtav_executable(path: &Path) -> bool {
    path.file_name().is_some_and(|name| {
        let name = name.to_string_lossy();
        name.eq_ignore_ascii_case("GTA5.exe") || name.eq_ignore_ascii_case("GTA5_Enhanced.exe")
    })
}

pub(super) fn emit_game_load_progress(
    app: &AppHandle,
    game_id: &str,
    stage: &str,
    message: &str,
    completed: usize,
    total: usize,
    progress: Option<u8>,
) {
    if let Err(error) = app.emit(
        "game-load-progress",
        GameLoadProgress {
            game_id: game_id.to_owned(),
            stage: stage.to_owned(),
            message: message.to_owned(),
            completed,
            total,
            progress,
        },
    ) {
        eprintln!("Could not send game loading progress: {error}");
    }
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
                display_path: None,
                _temporary_file: None,
                cache: Mutex::new(None),
                rdr2: true,
                requires_gtav: false,
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
    let root_slot_count = slots.len();
    Ok(ExplorerData {
        game_id: None,
        game_name: game_name.into(),
        root: folder,
        key: Some([0; 32]),
        gtav_keys: None,
        root_slot_count,
        status: format!(
            "{} RPF8 archives loaded. Hashed names appear in hexadecimal.{warning}",
            slots.len()
        ),
        slots,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_legacy_and_enhanced_gta_v_executables() {
        assert!(is_gtav_executable(Path::new("GTA5.exe")));
        assert!(is_gtav_executable(Path::new("GTA5_Enhanced.exe")));
        assert!(is_gtav_executable(Path::new("gta5_enhanced.EXE")));
        assert!(!is_gtav_executable(Path::new("PlayGTAV.exe")));
    }
}
