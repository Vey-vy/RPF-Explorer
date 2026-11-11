use aes::cipher::{generic_array::GenericArray, BlockDecrypt, KeyInit};
use aes::Aes256;
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;

pub const TOC_OFFSET: u64 = 0x800;
pub type Key = [u8; 32];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Version {
    Rpf2,
    Rpf3,
    Rpf4,
    Rpf6,
    Rpf7,
    Rpf8,
}

#[derive(Clone, Debug)]
pub struct ArchiveInfo {
    pub version: Version,
    pub toc_offset: u64,
    pub toc_size: usize,
    pub entry_count: usize,
    pub toc_encrypted: bool,
    pub files_encrypted: bool,
    pub debug_offset: u64,
    pub toc_head: [u8; 256],
}

pub fn decrypt_toc(buf: &mut [u8], key: &Key) {
    let cipher = Aes256::new(GenericArray::from_slice(key));
    for _ in 0..16 {
        for block in buf.chunks_exact_mut(16) {
            cipher.decrypt_block(GenericArray::from_mut_slice(block));
        }
    }
}

pub fn inspect(path: &Path) -> io::Result<ArchiveInfo> {
    let mut file = File::open(path)?;
    let file_len = file.metadata()?.len();
    let mut header = [0u8; 24];
    file.read_exact(&mut header)?;
    let magic = u32le(&header, 0);

    let (version, toc_offset, toc_size, entry_count, toc_encrypted, files_encrypted, debug_offset) =
        match magic {
            0x3246_5052 | 0x3346_5052 | 0x3446_5052 => {
                let version = match magic {
                    0x3246_5052 => Version::Rpf2,
                    0x3346_5052 => Version::Rpf3,
                    _ => Version::Rpf4,
                };
                let entry_count = u32le(&header, 8) as usize;
                let toc_size = u32le(&header, 4) as usize;
                let toc_encrypted = u32le(&header, 16) != 0;
                let files_encrypted = header.len() >= 24 && u32le(&header, 20) != 0;
                (
                    version,
                    TOC_OFFSET,
                    toc_size,
                    entry_count,
                    toc_encrypted,
                    files_encrypted,
                    0,
                )
            }
            0x3646_5052 => {
                let read_be = |offset: usize| {
                    u32::from_be_bytes(header[offset..offset + 4].try_into().unwrap())
                };
                let entry_count = read_be(4) as usize;
                let debug_offset = read_be(8) as u64 * 8;
                let toc_size = entry_count.checked_mul(20).ok_or_else(|| {
                    io::Error::new(io::ErrorKind::InvalidData, "Too many entries")
                })?;
                (
                    Version::Rpf6,
                    16,
                    (toc_size + 15) & !15,
                    entry_count,
                    read_be(12) != 0,
                    false,
                    debug_offset,
                )
            }
            0x5250_4637 => {
                let entry_count = u32le(&header, 4) as usize;
                let names_size = u32le(&header, 8) as usize;
                let entries_size = entry_count.checked_mul(16).ok_or_else(|| {
                    io::Error::new(io::ErrorKind::InvalidData, "Too many entries")
                })?;
                let toc_size = entries_size.checked_add(names_size).ok_or_else(|| {
                    io::Error::new(io::ErrorKind::InvalidData, "RPF7 TOC is too large")
                })?;
                let tag = u32le(&header, 12);
                (
                    Version::Rpf7,
                    16,
                    toc_size,
                    entry_count,
                    !matches!(tag, 0 | 0x4E45_504F | 0x5058_4643),
                    false,
                    0,
                )
            }
            0x5250_4638 => {
                let entry_count = u32le(&header, 4) as usize;
                let toc_size = entry_count.checked_mul(24).ok_or_else(|| {
                    io::Error::new(io::ErrorKind::InvalidData, "Too many entries")
                })?;
                let tag = u16::from_le_bytes(header[12..14].try_into().unwrap());
                (
                    Version::Rpf8,
                    16 + 256,
                    toc_size,
                    entry_count,
                    tag != 0x00FF,
                    false,
                    0,
                )
            }
            _ => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("Unsupported RPF format (magic {magic:#010x})"),
                ));
            }
        };

    let entries_size = match version {
        Version::Rpf2 | Version::Rpf3 | Version::Rpf4 => entry_count
            .checked_mul(16)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "Too many entries"))?,
        Version::Rpf6 => entry_count
            .checked_mul(20)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "Too many entries"))?,
        Version::Rpf7 => entry_count
            .checked_mul(16)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "Too many entries"))?,
        Version::Rpf8 => entry_count
            .checked_mul(24)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "Too many entries"))?,
    };
    if entry_count > 2_000_000
        || toc_size > 64 << 20
        || toc_size < entries_size
        || toc_offset.saturating_add(toc_size as u64) > file_len
        || debug_offset > file_len
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Inconsistent RPF header",
        ));
    }

    let mut toc_head = [0u8; 256];
    file.seek(SeekFrom::Start(toc_offset))?;
    let head_len = toc_size.min(toc_head.len());
    file.read_exact(&mut toc_head[..head_len])?;

    Ok(ArchiveInfo {
        version,
        toc_offset,
        toc_size,
        entry_count,
        toc_encrypted,
        files_encrypted,
        debug_offset,
        toc_head,
    })
}

pub(super) fn u32le(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
}

pub(super) fn cmp_ci(a: &str, b: &str) -> std::cmp::Ordering {
    a.bytes()
        .map(|c| c.to_ascii_lowercase())
        .cmp(b.bytes().map(|c| c.to_ascii_lowercase()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn write_test_archive(name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "rpf-explorer-{name}-{}-{nonce}.rpf",
            std::process::id()
        ));
        std::fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn inspects_empty_rpf7_header() {
        let mut bytes = vec![0u8; 24];
        bytes[..4].copy_from_slice(&0x5250_4637u32.to_le_bytes());
        bytes[12..16].copy_from_slice(&0u32.to_le_bytes());
        let path = write_test_archive("rpf7", &bytes);

        let info = inspect(&path).unwrap();

        assert_eq!(info.version, Version::Rpf7);
        assert_eq!(info.entry_count, 0);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn inspects_empty_rpf8_header_and_crypto_block() {
        let mut bytes = vec![0u8; 16 + 256];
        bytes[..4].copy_from_slice(&0x5250_4638u32.to_le_bytes());
        bytes[12..14].copy_from_slice(&0x00ffu16.to_le_bytes());
        let path = write_test_archive("rpf8", &bytes);

        let info = inspect(&path).unwrap();

        assert_eq!(info.version, Version::Rpf8);
        assert_eq!(info.entry_count, 0);
        assert!(!info.toc_encrypted);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn rejects_rpf7_header_with_truncated_toc() {
        let mut bytes = vec![0u8; 24];
        bytes[..4].copy_from_slice(&0x5250_4637u32.to_le_bytes());
        bytes[4..8].copy_from_slice(&1u32.to_le_bytes());
        let path = write_test_archive("rpf7-truncated", &bytes);

        assert!(inspect(&path).is_err());
        std::fs::remove_file(path).unwrap();
    }
}
