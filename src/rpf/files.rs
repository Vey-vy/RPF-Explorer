#[cfg(feature = "gui")]
use super::entry::Backend;
use super::entry::{Kind, Rpf};
use flate2::read::DeflateDecoder;
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;

impl Rpf {
    pub fn read_file(&self, idx: usize) -> io::Result<Vec<u8>> {
        let entry = self
            .entries
            .get(idx)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Invalid file index"))?;
        if entry.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Entry is a directory",
            ));
        }
        match self.backend.as_ref() {
            #[cfg(feature = "gui")]
            Some(Backend::GtaV {
                archive,
                data,
                keys,
            }) => {
                let source_entry = archive.entries.get(idx).ok_or_else(|| {
                    io::Error::new(io::ErrorKind::InvalidInput, "Invalid RPF7 index")
                })?;
                return archive
                    .extract_entry(data, source_entry, keys.as_deref())
                    .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error));
            }
            #[cfg(feature = "gui")]
            Some(Backend::Rdr2 {
                filesystem,
                archive_index,
            }) => {
                let entry_index = idx.checked_sub(1).ok_or_else(|| {
                    io::Error::new(io::ErrorKind::InvalidInput, "Invalid RPF8 index")
                })?;
                let archive = u32::try_from(*archive_index).map_err(|_| {
                    io::Error::new(io::ErrorKind::InvalidInput, "Invalid RPF8 index")
                })?;
                let entry = u32::try_from(entry_index).map_err(|_| {
                    io::Error::new(io::ErrorKind::InvalidInput, "Invalid RPF8 index")
                })?;
                return filesystem
                    .extract(rf_formats::rpf8::FileRef { archive, entry })
                    .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error));
            }
            #[cfg(not(feature = "gui"))]
            Some(_) => {}
            None => {}
        }
        let Kind::File {
            offset,
            size,
            stored,
            compressed,
            resource,
            encrypted,
        } = self.entries[idx].kind
        else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Entry is a directory",
            ));
        };
        if encrypted {
            return Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "File encryption is not supported for this RPF archive",
            ));
        }
        let mut file = File::open(&self.path)?;
        file.seek(SeekFrom::Start(offset))?;
        let mut raw = vec![0u8; stored as usize];
        file.read_exact(&mut raw)?;
        if resource || !compressed {
            return Ok(raw);
        }
        let mut output = Vec::with_capacity(size as usize);
        if self.version == super::format::Version::Rpf6
            && raw.starts_with(&[0x28, 0xB5, 0x2F, 0xFD])
        {
            zstd::stream::read::Decoder::new(&raw[..])?
                .take(size as u64 + 1)
                .read_to_end(&mut output)?;
        } else {
            DeflateDecoder::new(&raw[..])
                .take(size as u64 + 1)
                .read_to_end(&mut output)?;
        }
        if output.len() != size as usize {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!(
                    "Unexpected decompressed size: {} instead of {size}",
                    output.len()
                ),
            ));
        }
        Ok(output)
    }

    pub fn extract(&self, idx: usize, dest: &Path) -> io::Result<usize> {
        let entry = &self.entries[idx];
        match &entry.kind {
            Kind::File { .. } => {
                std::fs::create_dir_all(dest)?;
                let name = safe_name(&entry.name)?;
                std::fs::write(dest.join(name), self.read_file(idx)?)?;
                Ok(1)
            }
            Kind::Dir { kids } => {
                let directory = if idx == 0 {
                    dest.to_path_buf()
                } else {
                    dest.join(safe_name(&entry.name)?)
                };
                std::fs::create_dir_all(&directory)?;
                let mut count = 0;
                for &child in kids {
                    count += self.extract(child as usize, &directory)?;
                }
                Ok(count)
            }
        }
    }
}

fn safe_name(name: &str) -> io::Result<&str> {
    let path = Path::new(name);
    if path.components().count() != 1
        || path.file_name().and_then(|part| part.to_str()) != Some(name)
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Archive entry has an unsafe file name",
        ));
    }
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extraction_names_must_be_single_path_components() {
        assert_eq!(safe_name("asset.bin").unwrap(), "asset.bin");
        assert!(safe_name("../outside.bin").is_err());
        assert!(safe_name("folder\\outside.bin").is_err());
    }
}
