use super::*;
use crate::rpf::Version;
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::State;

static NEXT_TEMP_ARCHIVE: AtomicU64 = AtomicU64::new(0);
const MAX_NESTED_ARCHIVE_DEPTH: usize = 8;

#[tauri::command]
pub fn open_nested_archive(
    state: State<'_, ExplorerState>,
    parent_archive_index: usize,
    entry_index: usize,
) -> Result<ArchiveContent, String> {
    let mut data = state
        .inner
        .lock()
        .map_err(|_| "Application state is unavailable")?;
    open_nested_archive_in(&mut data, parent_archive_index, entry_index)
}

#[tauri::command]
pub fn close_nested_archives(
    state: State<'_, ExplorerState>,
    keep_archive_index: usize,
) -> Result<(), String> {
    let mut data = state
        .inner
        .lock()
        .map_err(|_| "Application state is unavailable")?;
    if keep_archive_index >= data.slots.len() {
        return Err("Archive not found.".into());
    }
    let keep_count = data.root_slot_count.max(keep_archive_index + 1);
    data.slots.truncate(keep_count);
    Ok(())
}

fn open_nested_archive_in(
    data: &mut ExplorerData,
    parent_archive_index: usize,
    entry_index: usize,
) -> Result<ArchiveContent, String> {
    let parent_depth = parent_archive_index
        .checked_sub(data.root_slot_count)
        .map_or(0, |depth| depth + 1);
    if parent_depth >= MAX_NESTED_ARCHIVE_DEPTH {
        return Err("Nested RPF depth is limited to 8 archives.".into());
    }
    let (parent, entry) = get_entry(data, parent_archive_index, entry_index)?;
    if entry.is_dir() || preview::extension(&entry.name) != "rpf" {
        return Err("Select an RPF file inside the archive.".into());
    }
    if entry.size() as usize > NESTED_ARCHIVE_LIMIT {
        return Err("Nested RPF previews are limited to 512 MiB.".into());
    }

    let archive_bytes = parent
        .read_file(entry_index)
        .map_err(|error| format!("Could not read nested RPF: {error}"))?;
    if archive_bytes.len() > NESTED_ARCHIVE_LIMIT {
        return Err("Nested RPF previews are limited to 512 MiB.".into());
    }
    let temporary_file = create_temporary_archive(&archive_bytes)?;
    let info = rpf::inspect(&temporary_file.0)
        .map_err(|error| format!("The nested file is not a readable RPF archive: {error}"))?;
    if info.version == Version::Rpf8 {
        return Err("Nested RPF8 archives are not supported yet.".into());
    }
    let requires_gtav = info.version == Version::Rpf7;
    if requires_gtav && data.gtav_keys.is_none() {
        return Err("This nested RPF7 archive requires GTA V keys.".into());
    }
    let nested = if requires_gtav {
        Rpf::open_gtav_with_name(&temporary_file.0, &entry.name, data.gtav_keys.clone())
    } else {
        Rpf::open(
            &temporary_file.0,
            &data.key.ok_or("No archive key is available")?,
        )
    }
    .map_err(|error| format!("Could not open nested RPF: {error}"))?;
    let nested = Arc::new(nested);

    let parent_slot = data
        .slots
        .get(parent_archive_index)
        .ok_or("Archive not found")?;
    let base_path = archive_display_path(data, parent_slot);
    let parents = build_parent_indices(&parent.entries);
    let nested_path = format!(
        "{base_path}!/{}",
        entry_full_path(&parent.entries, &parents, entry_index)
    );
    let archive_index = data.slots.len();
    let mut entries = Vec::new();
    append_entries(&nested.entries, 0, None, 0, "", &mut entries);
    let retained_slots = data
        .root_slot_count
        .max(parent_archive_index.saturating_add(1));
    data.slots.truncate(retained_slots);
    data.slots.push(Arc::new(ArchiveSlot {
        path: temporary_file.0.clone(),
        display_path: Some(nested_path.clone()),
        _temporary_file: Some(Arc::new(temporary_file)),
        cache: Mutex::new(Some(Ok(nested.clone()))),
        rdr2: false,
        requires_gtav,
        rdr2_filesystem: None,
        rdr2_index: None,
    }));

    Ok(ArchiveContent {
        index: archive_index,
        path: nested_path,
        version: format!("{:?}", nested.version).to_uppercase(),
        entries,
    })
}

fn create_temporary_archive(bytes: &[u8]) -> Result<TemporaryArchiveFile, String> {
    for _ in 0..16 {
        let sequence = NEXT_TEMP_ARCHIVE.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "rpf-explorer-nested-{}-{sequence}.rpf",
            std::process::id()
        ));
        let mut file = match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!("Could not create temporary nested RPF: {error}"));
            }
        };
        if let Err(error) = file.write_all(bytes) {
            let _ = std::fs::remove_file(&path);
            return Err(format!("Could not store temporary nested RPF: {error}"));
        }
        return Ok(TemporaryArchiveFile(path));
    }
    Err("Could not allocate a temporary nested RPF file.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_nested_rpf_and_keeps_it_available_for_follow_up_requests() {
        let nested_bytes = empty_rpf4();
        let parent_path = write_parent_rpf(&nested_bytes);
        let parent = Arc::new(Rpf::open(&parent_path, &[0; 32]).unwrap());
        let mut data = ExplorerData {
            game_id: Some("gta-v".into()),
            game_name: "GTA V".into(),
            root: parent_path.parent().unwrap().to_path_buf(),
            key: Some([0; 32]),
            gtav_keys: None,
            slots: vec![Arc::new(ArchiveSlot {
                path: parent_path.clone(),
                display_path: None,
                cache: Mutex::new(Some(Ok(parent))),
                rdr2: false,
                requires_gtav: false,
                rdr2_filesystem: None,
                rdr2_index: None,
                _temporary_file: None,
            })],
            root_slot_count: 1,
            status: String::new(),
        };

        let opened = open_nested_archive_in(&mut data, 0, 1).unwrap();
        let nested_path = data.slots[opened.index].path.clone();
        assert_eq!(opened.version, "RPF4");
        assert_eq!(opened.index, 1);
        assert!(nested_path.is_file());
        assert_eq!(data.slots.len(), 2);

        drop(data);
        assert!(!nested_path.exists());
        let _ = std::fs::remove_file(parent_path);
    }

    #[test]
    fn opens_non_empty_nested_rpf7_with_its_archive_name() {
        let mut builder = rpf_archive::RpfBuilder::new(rpf_archive::RpfEncryption::Open);
        builder.add_file("inside.txt", b"nested contents".to_vec());
        let nested_bytes = builder.build(None).unwrap();
        let parent_path = write_parent_rpf(&nested_bytes);
        let parent = Arc::new(Rpf::open(&parent_path, &[0; 32]).unwrap());
        let ng_decrypt_tables: Box<[[[u32; 256]; 16]; 17]> = vec![[[0u32; 256]; 16]; 17]
            .into_boxed_slice()
            .try_into()
            .unwrap();
        let gtav_keys = Arc::new(rpf_archive::GtaKeys {
            aes_key: [0; 32],
            ng_keys: Vec::new(),
            ng_decrypt_tables,
        });
        let mut data = ExplorerData {
            game_id: Some("gta-v".into()),
            game_name: "GTA V".into(),
            root: parent_path.parent().unwrap().to_path_buf(),
            key: Some([0; 32]),
            gtav_keys: Some(gtav_keys),
            slots: vec![Arc::new(ArchiveSlot {
                path: parent_path.clone(),
                display_path: None,
                cache: Mutex::new(Some(Ok(parent))),
                rdr2: false,
                requires_gtav: false,
                rdr2_filesystem: None,
                rdr2_index: None,
                _temporary_file: None,
            })],
            root_slot_count: 1,
            status: String::new(),
        };

        let opened = open_nested_archive_in(&mut data, 0, 1).unwrap();
        assert_eq!(opened.version, "RPF7");
        assert_eq!(opened.entries.len(), 2);
        assert_eq!(opened.entries[1].name, "inside.txt");
        let nested = data.slots[opened.index].peek().unwrap().unwrap();
        assert_eq!(nested.read_file(1).unwrap(), b"nested contents");
        let Some(crate::rpf::Backend::GtaV { archive, .. }) = nested.backend.as_ref() else {
            panic!("RPF7 archive should use the GTA V backend");
        };
        assert_eq!(archive.name, "nested.rpf");
        let nested_path = data.slots[opened.index].path.clone();

        drop(data);
        assert!(!nested_path.exists());
        let _ = std::fs::remove_file(parent_path);
    }

    fn empty_rpf4() -> Vec<u8> {
        let mut bytes = vec![0; 0x810];
        bytes[..4].copy_from_slice(b"RPF4");
        bytes
    }

    fn write_parent_rpf(nested: &[u8]) -> PathBuf {
        let name = b"nested.rpf\0";
        let toc_size = 32 + name.len();
        let toc_padded = (toc_size + 15) & !15;
        let data_offset = 0x800 + toc_padded;
        let mut bytes = vec![0; data_offset + nested.len()];
        bytes[..4].copy_from_slice(b"RPF4");
        bytes[4..8].copy_from_slice(&(toc_size as u32).to_le_bytes());
        bytes[8..12].copy_from_slice(&2u32.to_le_bytes());

        let root_entry = 0x800;
        bytes[root_entry + 8..root_entry + 12].copy_from_slice(&0x8000_0001u32.to_le_bytes());
        bytes[root_entry + 12..root_entry + 16].copy_from_slice(&1u32.to_le_bytes());
        let file_entry = root_entry + 16;
        bytes[file_entry..file_entry + 4].copy_from_slice(&0u32.to_le_bytes());
        bytes[file_entry + 4..file_entry + 8].copy_from_slice(&(nested.len() as u32).to_le_bytes());
        bytes[file_entry + 8..file_entry + 12]
            .copy_from_slice(&((data_offset / 8) as u32).to_le_bytes());
        bytes[file_entry + 12..file_entry + 16]
            .copy_from_slice(&(nested.len() as u32).to_le_bytes());
        bytes[root_entry + 32..root_entry + 32 + name.len()].copy_from_slice(name);
        bytes[data_offset..].copy_from_slice(nested);

        let path = std::env::temp_dir().join(format!(
            "rpf-explorer-nested-parent-{}-{}.rpf",
            std::process::id(),
            NEXT_TEMP_ARCHIVE.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::write(&path, bytes).unwrap();
        path
    }
}
