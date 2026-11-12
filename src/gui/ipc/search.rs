use super::*;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, State};

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
            data.slots
                .iter()
                .take(data.root_slot_count)
                .cloned()
                .collect::<Vec<_>>(),
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
