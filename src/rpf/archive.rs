use super::decrypt_toc;
#[cfg(feature = "gui")]
use super::entry::Backend;
use super::entry::{Entry, Kind, Rpf};
use super::format::{cmp_ci, inspect, u32le, ArchiveInfo, Key, Version};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
#[cfg(feature = "gui")]
use std::sync::Arc;

impl Rpf {
    pub fn open(path: &Path, key: &Key) -> Result<Rpf, String> {
        let info = inspect(path).map_err(|error| error.to_string())?;
        let mut file = File::open(path).map_err(|error| format!("Could not open file: {error}"))?;
        if info.entry_count == 0 {
            return Ok(Rpf {
                path: path.to_path_buf(),
                entries: vec![Entry {
                    name: "/".into(),
                    kind: Kind::Dir { kids: Vec::new() },
                }],
                version: info.version,
                backend: None,
            });
        }

        let toc_size = match info.version {
            Version::Rpf2 | Version::Rpf3 | Version::Rpf4 => {
                let entry_size = info.entry_count * 16;
                let size = info.toc_size.min(
                    file.metadata()
                        .map_err(|error| error.to_string())?
                        .len()
                        .saturating_sub(info.toc_offset) as usize,
                );
                if size < entry_size {
                    return Err("Truncated RPF TOC".into());
                }
                (size + 15) & !15
            }
            Version::Rpf6 => info.toc_size,
            Version::Rpf7 | Version::Rpf8 => {
                return Err("This format requires game-specific keys".into())
            }
        };
        let file_len = file.metadata().map_err(|error| error.to_string())?.len();
        if info.toc_offset.saturating_add(toc_size as u64) > file_len {
            return Err("Truncated RPF TOC".into());
        }
        let mut toc = vec![0u8; toc_size];
        file.seek(SeekFrom::Start(info.toc_offset))
            .map_err(|error| error.to_string())?;
        file.read_exact(&mut toc)
            .map_err(|error| format!("Could not read TOC: {error}"))?;
        if info.toc_encrypted {
            decrypt_toc(&mut toc, key);
        }

        let entries = match info.version {
            Version::Rpf2 | Version::Rpf3 | Version::Rpf4 => parse_little_endian(&info, &toc)?,
            Version::Rpf6 => parse_rpf6(path, &info, &toc, key)?,
            Version::Rpf7 | Version::Rpf8 => {
                return Err("This format requires game-specific keys".into())
            }
        };
        Ok(Rpf {
            path: path.to_path_buf(),
            entries,
            version: info.version,
            backend: None,
        })
    }

    #[cfg(feature = "gui")]
    pub fn open_gtav(path: &Path, keys: Option<Arc<rpf_archive::GtaKeys>>) -> Result<Rpf, String> {
        let file = File::open(path).map_err(|error| error.to_string())?;
        let data = Arc::new(
            unsafe { memmap2::Mmap::map(&file) }
                .map_err(|error| format!("Could not map archive: {error}"))?,
        );
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        let archive = rpf_archive::RpfArchive::parse(&data, name, keys.as_deref())
            .map_err(|error| format!("Could not read RPF7 archive: {error}"))?;
        if archive.version != rpf_archive::RpfVersion::V7 {
            return Err("The selected archive is not in RPF7 format".into());
        }

        let mut entries = Vec::with_capacity(archive.entries.len());
        for (index, entry) in archive.entries.iter().enumerate() {
            let kind = match &entry.kind {
                rpf_archive::RpfEntryKind::Directory {
                    entries_index,
                    entries_count,
                } => {
                    let start = *entries_index as usize;
                    let count = *entries_count as usize;
                    if start > archive.entries.len()
                        || count > archive.entries.len().saturating_sub(start)
                    {
                        return Err(format!("Invalid RPF7 directory bounds at entry {index}"));
                    }
                    Kind::Dir {
                        kids: (start as u32..(start + count) as u32).collect(),
                    }
                }
                rpf_archive::RpfEntryKind::BinaryFile {
                    file_offset,
                    file_size,
                    uncompressed_size,
                    is_encrypted,
                } => Kind::File {
                    offset: *file_offset as u64 * 512,
                    size: *uncompressed_size,
                    stored: *file_size,
                    compressed: *file_size != 0 && *file_size < *uncompressed_size,
                    resource: false,
                    encrypted: *is_encrypted,
                },
                rpf_archive::RpfEntryKind::ResourceFile {
                    file_offset,
                    file_size,
                    is_encrypted,
                    ..
                } => Kind::File {
                    offset: *file_offset as u64 * 512,
                    size: *file_size,
                    stored: *file_size,
                    compressed: false,
                    resource: true,
                    encrypted: *is_encrypted,
                },
            };
            entries.push(Entry {
                name: entry.name.clone(),
                kind,
            });
        }

        Ok(Rpf {
            path: path.to_path_buf(),
            entries,
            version: Version::Rpf7,
            backend: Some(Backend::GtaV {
                archive,
                data,
                keys,
            }),
        })
    }

    #[cfg(feature = "gui")]
    pub fn from_rdr2(
        filesystem: Arc<rf_formats::rpf8::Rpf8FileSystem>,
        archive_index: usize,
    ) -> Result<Rpf, String> {
        let archive = filesystem
            .archives
            .get(archive_index)
            .ok_or_else(|| format!("Invalid RPF8 archive index: {archive_index}"))?;
        let mut entries = Vec::with_capacity(archive.entries.len() + 1);
        entries.push(Entry {
            name: "/".into(),
            kind: Kind::Dir {
                kids: (1..=archive.entries.len() as u32).collect(),
            },
        });
        for (index, item) in archive.entries.iter().enumerate() {
            let name = archive
                .names
                .get(index)
                .map(|name| name.rsplit('/').next().unwrap_or(name).to_string())
                .unwrap_or_else(|| format!("$entry_{index}"));
            let size = u32::try_from(item.decompressed_size())
                .map_err(|_| format!("RPF8 file is too large: {name}"))?;
            let stored = u32::try_from(item.file_size())
                .map_err(|_| format!("RPF8 file is too large: {name}"))?;
            let kind = Kind::File {
                offset: item.offset(),
                size,
                stored,
                compressed: item.compressor() != 0,
                resource: item.is_resource(),
                encrypted: item.is_encrypted(),
            };
            entries.push(Entry { name, kind });
        }
        Ok(Rpf {
            path: filesystem.folder.join(&archive.path),
            entries,
            version: Version::Rpf8,
            backend: Some(Backend::Rdr2 {
                filesystem,
                archive_index,
            }),
        })
    }
}

fn parse_little_endian(info: &ArchiveInfo, toc: &[u8]) -> Result<Vec<Entry>, String> {
    let entry_size = info.entry_count * 16;
    if entry_size > toc.len() {
        return Err("Truncated RPF TOC".into());
    }
    let names = &toc[entry_size..];
    let name_at = |offset: usize| -> String {
        let bytes = names.get(offset..).unwrap_or(&[]);
        let end = bytes
            .iter()
            .position(|&byte| byte == 0)
            .unwrap_or(bytes.len());
        String::from_utf8_lossy(&bytes[..end]).into_owned()
    };

    let mut entries = Vec::with_capacity(info.entry_count);
    for index in 0..info.entry_count {
        let word = |n: usize| u32le(toc, index * 16 + n * 4);
        let name_value = word(0);
        let word1 = word(1);
        let word2 = word(2);
        let word3 = word(3);
        let is_dir = word2 & 0x8000_0000 != 0;
        let is_resource = info.version != Version::Rpf4 && word3 & 0x8000_0000 != 0;
        let name = match info.version {
            Version::Rpf3 => format!("${name_value:08X}"),
            _ if is_dir && index == 0 => "/".to_owned(),
            _ => {
                let value = name_at(name_value as usize);
                if value.is_empty() && info.version == Version::Rpf4 {
                    format!("${name_value:08X}")
                } else {
                    value
                }
            }
        };

        let kind = if is_dir {
            let first = (word2 & 0x7fff_ffff) as usize;
            let child_count = (word3 & 0x3fff_ffff) as usize;
            if first > info.entry_count || child_count > info.entry_count.saturating_sub(first) {
                return Err(format!("Invalid directory bounds at entry {index}"));
            }
            Kind::Dir {
                kids: (first as u32..(first + child_count) as u32).collect(),
            }
        } else {
            let compressed = word3 & 0x4000_0000 != 0;
            let (offset, size, stored) = match info.version {
                Version::Rpf4 => (word2 as u64 * 8, word1, word3 & 0x3fff_ffff),
                Version::Rpf2 | Version::Rpf3 if is_resource => (
                    (word2 & 0x7fff_ff00) as u64,
                    resource_size(word3, 0, false),
                    word1,
                ),
                Version::Rpf2 | Version::Rpf3 => {
                    ((word2 & 0x7fff_ffff) as u64, word1, word3 & 0x3fff_ffff)
                }
                Version::Rpf6 | Version::Rpf7 | Version::Rpf8 => unreachable!(),
            };
            Kind::File {
                offset,
                size,
                stored,
                compressed,
                resource: is_resource,
                encrypted: info.files_encrypted,
            }
        };
        entries.push(Entry { name, kind });
    }

    sort_children(&mut entries)?;
    Ok(entries)
}

fn parse_rpf6(
    path: &Path,
    info: &ArchiveInfo,
    toc: &[u8],
    key: &Key,
) -> Result<Vec<Entry>, String> {
    let mut debug_data = if info.debug_offset != 0 {
        let file_len = std::fs::metadata(path)
            .map_err(|error| error.to_string())?
            .len();
        let size = file_len.saturating_sub(info.debug_offset) as usize;
        if size > 64 << 20 {
            return Err("RPF6 name data is too large".into());
        }
        let mut file = File::open(path).map_err(|error| error.to_string())?;
        file.seek(SeekFrom::Start(info.debug_offset))
            .map_err(|error| error.to_string())?;
        let mut data = vec![0u8; size];
        file.read_exact(&mut data)
            .map_err(|error| format!("Could not read name data: {error}"))?;
        if info.toc_encrypted {
            let aligned = data.len() & !15;
            decrypt_toc(&mut data[..aligned], key);
        }
        Some(data)
    } else {
        None
    };

    let debug_names_start = info.entry_count * 8;
    let debug_names = debug_data
        .as_mut()
        .filter(|data| data.len() >= debug_names_start)
        .map(|data| data.split_off(debug_names_start));
    let debug_offsets = debug_data.map(|data| {
        data.chunks_exact(8)
            .take(info.entry_count)
            .map(|entry| u32::from_be_bytes(entry[..4].try_into().unwrap()) as usize)
            .collect::<Vec<_>>()
    });

    let read_be = |offset: usize| u32::from_be_bytes(toc[offset..offset + 4].try_into().unwrap());
    let mut entries = Vec::with_capacity(info.entry_count);
    for index in 0..info.entry_count {
        let offset = index * 20;
        let hash = read_be(offset);
        let on_disk_size = read_be(offset + 4);
        let word2 = read_be(offset + 8);
        let word3 = read_be(offset + 12);
        let word4 = read_be(offset + 16);
        let is_dir = word2 & 0x8000_0000 != 0;
        let is_resource = word3 & 0x8000_0000 != 0;
        let name = debug_offsets
            .as_ref()
            .and_then(|offsets| offsets.get(index))
            .and_then(|name_offset| debug_names.as_ref()?.get(*name_offset..))
            .map(|bytes| {
                let end = bytes
                    .iter()
                    .position(|&byte| byte == 0)
                    .unwrap_or(bytes.len());
                String::from_utf8_lossy(&bytes[..end]).into_owned()
            })
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| format!("${hash:08X}"));

        let kind = if is_dir {
            let first = (word2 & 0x7fff_ffff) as usize;
            let child_count = (word3 & 0x3fff_ffff) as usize;
            if first > info.entry_count || child_count > info.entry_count.saturating_sub(first) {
                return Err(format!("Invalid directory bounds at entry {index}"));
            }
            Kind::Dir {
                kids: (first as u32..(first + child_count) as u32).collect(),
            }
        } else {
            let compressed = word3 & 0x4000_0000 != 0;
            let size = if is_resource {
                resource_size(word3, word4, word4 & 0x8000_0000 != 0)
            } else if compressed {
                word3 & 0x3fff_ffff
            } else {
                on_disk_size & 0x7fff_ffff
            };
            let raw_offset = if is_resource {
                word2 & 0x7fff_ff00
            } else {
                word2 & 0x7fff_ffff
            };
            Kind::File {
                offset: raw_offset as u64 * 8,
                size,
                stored: on_disk_size & 0x7fff_ffff,
                compressed,
                resource: is_resource,
                encrypted: false,
            }
        };
        entries.push(Entry { name, kind });
    }
    sort_children(&mut entries)?;
    Ok(entries)
}

fn resource_size(flags: u32, extended_flags: u32, extended: bool) -> u32 {
    let (virtual_size, physical_size) = if extended {
        (
            (extended_flags & 0x3fff) << 12,
            ((extended_flags >> 14) & 0x3fff) << 12,
        )
    } else {
        (
            (flags & 0x7ff) << (((flags >> 11) & 0xf) + 8),
            ((flags >> 15) & 0x7ff) << (((flags >> 26) & 0xf) + 8),
        )
    };
    virtual_size.saturating_add(physical_size)
}

fn sort_children(entries: &mut [Entry]) -> Result<(), String> {
    for index in 0..entries.len() {
        let mut kids = match &mut entries[index].kind {
            Kind::Dir { kids } => std::mem::take(kids),
            _ => continue,
        };
        if kids.iter().any(|&child| child as usize >= entries.len()) {
            return Err(format!("Invalid child entry in directory {index}"));
        }
        kids.sort_by(|&a, &b| {
            let (ea, eb) = (&entries[a as usize], &entries[b as usize]);
            (!ea.is_dir())
                .cmp(&!eb.is_dir())
                .then_with(|| cmp_ci(&ea.name, &eb.name))
        });
        if let Kind::Dir { kids: sorted } = &mut entries[index].kind {
            *sorted = kids;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use aes::cipher::{generic_array::GenericArray, BlockEncrypt, KeyInit};
    use aes::Aes256;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_archive(name: &str, data: &[u8]) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "rpf-explorer-{name}-{}-{nonce}.rpf",
            std::process::id()
        ));
        std::fs::write(&path, data).unwrap();
        path
    }

    #[test]
    fn opens_gta_iv_rpf2_and_reads_binary_file() {
        let mut data = vec![0u8; 0x844];
        data[0..4].copy_from_slice(&0x3246_5052u32.to_le_bytes());
        data[4..8].copy_from_slice(&42u32.to_le_bytes());
        data[8..12].copy_from_slice(&2u32.to_le_bytes());

        let toc = 0x800;
        data[toc + 8..toc + 12].copy_from_slice(&0x8000_0001u32.to_le_bytes());
        data[toc + 12..toc + 16].copy_from_slice(&1u32.to_le_bytes());
        data[toc + 16..toc + 20].copy_from_slice(&0u32.to_le_bytes());
        data[toc + 20..toc + 24].copy_from_slice(&4u32.to_le_bytes());
        data[toc + 24..toc + 28].copy_from_slice(&0x840u32.to_le_bytes());
        data[toc + 28..toc + 32].copy_from_slice(&4u32.to_le_bytes());
        data[toc + 32..toc + 42].copy_from_slice(b"hello.bin\0");
        data[0x840..0x844].copy_from_slice(b"test");

        let path = temp_archive("gtaiv", &data);
        let archive = Rpf::open(&path, &[0; 32]).unwrap();
        assert_eq!(archive.version, Version::Rpf2);
        assert_eq!(archive.entries[1].name, "hello.bin");
        assert_eq!(archive.read_file(1).unwrap(), b"test");
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn opens_rdr1_rpf6_with_big_endian_entries() {
        let mut data = vec![0u8; 68];
        let key: Key = std::array::from_fn(|index| (index as u8).wrapping_mul(7) + 1);
        data[0..4].copy_from_slice(&0x3646_5052u32.to_le_bytes());
        data[4..8].copy_from_slice(&2u32.to_be_bytes());
        data[12..16].copy_from_slice(&0xffff_fffdu32.to_be_bytes());

        data[24..28].copy_from_slice(&0x8000_0001u32.to_be_bytes());
        data[28..32].copy_from_slice(&1u32.to_be_bytes());
        data[36..40].copy_from_slice(&0x1234u32.to_be_bytes());
        data[40..44].copy_from_slice(&4u32.to_be_bytes());
        data[44..48].copy_from_slice(&8u32.to_be_bytes());
        data[48..52].copy_from_slice(&4u32.to_be_bytes());
        data[64..68].copy_from_slice(b"test");

        let cipher = Aes256::new(GenericArray::from_slice(&key));
        for _ in 0..16 {
            for block in data[16..64].chunks_exact_mut(16) {
                cipher.encrypt_block(GenericArray::from_mut_slice(block));
            }
        }

        let path = temp_archive("rdr1", &data);
        let info = inspect(&path).unwrap();
        assert!(crate::keyfinder::validate_archive_key(&key, &info));
        assert_eq!(
            crate::keyfinder::find_key_for_archive(&key, &info),
            Some((key, 0))
        );
        let archive = Rpf::open(&path, &key).unwrap();
        assert_eq!(archive.version, Version::Rpf6);
        assert_eq!(archive.entries[1].name, "$00001234");
        assert_eq!(archive.read_file(1).unwrap(), b"test");
        std::fs::remove_file(path).unwrap();
    }
}
