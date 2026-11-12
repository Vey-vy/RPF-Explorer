mod ipc;
mod model_preview;

pub fn run() -> tauri::Result<()> {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ipc::ExplorerState::default())
        .invoke_handler(tauri::generate_handler![
            ipc::game::choose_game_folder,
            ipc::get_summary,
            ipc::archive::list_game_directory,
            ipc::archive::open_archive,
            ipc::nested::open_nested_archive,
            ipc::nested::close_nested_archives,
            ipc::preview::preview_game_file,
            ipc::preview::preview_entry,
            ipc::archive::extract_file,
            ipc::archive::extract_folder,
            ipc::search::index_archives,
        ])
        .run(tauri::generate_context!())
}
