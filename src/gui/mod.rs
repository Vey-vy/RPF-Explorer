mod ipc;

pub fn run() -> tauri::Result<()> {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ipc::ExplorerState::default())
        .invoke_handler(tauri::generate_handler![
            ipc::choose_game_folder,
            ipc::get_summary,
            ipc::open_archive,
            ipc::preview_entry,
            ipc::extract_file,
            ipc::extract_folder,
            ipc::index_archives,
        ])
        .run(tauri::generate_context!())
}
