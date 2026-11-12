use super::*;
use crate::keyfinder;
use crate::rpf::ArchiveInfo;
use rayon::prelude::*;
use sha1::{Digest, Sha1};
use std::io::Write;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;
use tauri::AppHandle;

const GTAV_AES_KEY_HASH: [u8; 20] = [
    0xA0, 0x79, 0x61, 0x28, 0xA7, 0x75, 0x72, 0x0A, 0xC2, 0x04, 0xD9, 0x81, 0x9F, 0x68, 0xC1, 0x72,
    0xE3, 0x95, 0x2C, 0x6D,
];

pub(super) fn extract_gtav_keys(
    executable: &Path,
    cache_dir: &Path,
    app: &AppHandle,
    game_id: &str,
) -> Result<rpf_archive::GtaKeys, String> {
    match rpf_archive::GtaKeys::load_from_path(cache_dir) {
        Ok(keys) => return Ok(keys),
        Err(error) if cache_dir.exists() => {
            eprintln!("Ignoring unusable cached GTA V encryption keys: {error}");
        }
        Err(_) => {}
    }
    if !executable.is_file() {
        return Err(format!(
            "Could not find GTA5.exe in the selected folder: {}",
            executable.display()
        ));
    }

    super::game::emit_game_load_progress(
        app,
        game_id,
        "keys",
        "Scanning GTA5.exe for its encryption key…",
        0,
        0,
        None,
    );
    let exe_file = std::fs::File::open(executable)
        .map_err(|error| format!("Could not read GTA5.exe: {error}"))?;
    let executable_data = unsafe { memmap2::Mmap::map(&exe_file) }
        .map_err(|error| format!("Could not map GTA5.exe: {error}"))?;
    let key = find_gtav_key(&executable_data, app, game_id)
        .ok_or("Could not find GTA V encryption keys in GTA5.exe.")?;
    super::game::emit_game_load_progress(
        app,
        game_id,
        "keys",
        "Building GTA V archive keys…",
        0,
        0,
        Some(97),
    );

    let temporary_key = write_temporary_key_file(&key)?;
    let executable = temporary_key.clone();
    let cache_dir = cache_dir.to_path_buf();
    let extracted = thread::Builder::new()
        .name("gtav-key-extraction".into())
        .stack_size(16 * 1024 * 1024)
        .spawn(move || {
            rpf_archive::GtaKeys::extract_from_exe(&executable, Some(&cache_dir)).map_err(|error| {
                format!("Could not load GTA V encryption keys from GTA5.exe: {error}")
            })
        })
        .map_err(|error| format!("Could not start GTA V key extraction: {error}"))
        .and_then(|worker| {
            worker
                .join()
                .map_err(|_| "GTA V key extraction terminated unexpectedly.".to_owned())?
        });
    let cleanup = std::fs::remove_file(&temporary_key)
        .map_err(|error| format!("Could not remove temporary key file: {error}"));
    match (extracted, cleanup) {
        (Ok(keys), Ok(())) => Ok(keys),
        (Err(error), _) => Err(error),
        (Ok(_), Err(error)) => Err(error),
    }
}

fn find_gtav_key(data: &[u8], app: &AppHandle, game_id: &str) -> Option<[u8; 32]> {
    const CHUNK_SIZE: usize = 1024 * 1024;
    let candidate_count = data.len().checked_sub(31)?;
    let chunk_count = candidate_count.div_ceil(CHUNK_SIZE);
    let completed = AtomicUsize::new(0);
    let last_reported = Mutex::new(0usize);
    let report_interval = (chunk_count / 80).max(1);

    (0..chunk_count)
        .into_par_iter()
        .find_map_any(|chunk_index| {
            let start = chunk_index * CHUNK_SIZE;
            let end = (start + CHUNK_SIZE).min(candidate_count);
            for offset in start..end {
                if Sha1::digest(&data[offset..offset + 32])[..] == GTAV_AES_KEY_HASH {
                    return Some(data[offset..offset + 32].try_into().ok()?);
                }
            }

            let count = completed.fetch_add(1, Ordering::Relaxed) + 1;
            if count == chunk_count || count.is_multiple_of(report_interval) {
                if let Ok(mut previous) = last_reported.lock() {
                    if count > *previous {
                        *previous = count;
                        super::game::emit_game_load_progress(
                            app,
                            game_id,
                            "keys",
                            &format!("Scanning GTA5.exe… {count} of {chunk_count}"),
                            count,
                            chunk_count,
                            Some(75 + (count * 20 / chunk_count.max(1)) as u8),
                        );
                    }
                }
            }
            None
        })
}

fn write_temporary_key_file(key: &[u8; 32]) -> Result<PathBuf, String> {
    let temp_dir = std::env::temp_dir();
    for attempt in 0..10u32 {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|error| format!("Could not create temporary key file: {error}"))?
            .as_nanos();
        let path = temp_dir.join(format!(
            "rpf-explorer-gtav-key-{}-{timestamp}-{attempt}.tmp",
            std::process::id()
        ));
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut file) => {
                if let Err(error) = file.write_all(key) {
                    let _ = std::fs::remove_file(&path);
                    return Err(format!("Could not prepare GTA V key extraction: {error}"));
                }
                return Ok(path);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!("Could not prepare GTA V key extraction: {error}"));
            }
        }
    }
    Err("Could not create a temporary GTA V key file.".into())
}

pub(super) fn find_key(info: &ArchiveInfo, executables: &[PathBuf]) -> Result<Key, String> {
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
