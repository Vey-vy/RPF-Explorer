use super::*;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub fn list_game_directory(
    state: State<'_, ExplorerState>,
    relative_path: String,
) -> Result<Vec<GameDirectoryEntry>, String> {
    let root_path = {
        let data = state
            .inner
            .lock()
            .map_err(|_| "Application state is unavailable")?;
        if data.game_id.is_none() {
            return Err("No game folder is selected.".into());
        }
        data.root.clone()
    };

    let relative_path = Path::new(&relative_path);
    if relative_path
        .components()
        .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return Err("The requested game folder path is invalid.".into());
    }

    let root = root_path
        .canonicalize()
        .map_err(|error| format!("Could not access the selected game folder: {error}"))?;
    let directory = root
        .join(relative_path)
        .canonicalize()
        .map_err(|error| format!("Could not access game folder contents: {error}"))?;
    if !directory.starts_with(&root) || !directory.is_dir() {
        return Err("The requested path is not a folder inside the selected game folder.".into());
    }

    let mut entries = std::fs::read_dir(&directory)
        .map_err(|error| format!("Could not read game folder contents: {error}"))?
        .map(|entry| {
            let entry =
                entry.map_err(|error| format!("Could not read a game folder entry: {error}"))?;
            let file_type = entry.file_type().map_err(|error| {
                format!("Could not inspect {}: {error}", entry.path().display())
            })?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let path = relative(&root, &entry.path());
            let is_dir = file_type.is_dir();
            let is_archive = !is_dir
                && entry
                    .path()
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("rpf"));
            let size = if file_type.is_file() {
                entry
                    .metadata()
                    .map_err(|error| {
                        format!("Could not inspect {}: {error}", entry.path().display())
                    })?
                    .len()
            } else {
                0
            };
            Ok(GameDirectoryEntry {
                name,
                path,
                is_dir,
                is_archive,
                size,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;

    entries.sort_by(|left, right| {
        right
            .is_dir
            .cmp(&left.is_dir)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(entries)
}

#[tauri::command]
pub fn open_archive(
    state: State<'_, ExplorerState>,
    archive_index: usize,
) -> Result<ArchiveContent, String> {
    let mut data = state
        .inner
        .lock()
        .map_err(|_| "Application state is unavailable")?;
    if archive_index < data.root_slot_count {
        let root_slot_count = data.root_slot_count;
        data.slots.truncate(root_slot_count);
    }
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
        path: archive_display_path(&data, slot),
        version: format!("{:?}", rpf.version).to_uppercase(),
        entries,
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
