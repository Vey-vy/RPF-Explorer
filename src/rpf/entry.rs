use std::path::PathBuf;
#[cfg(feature = "gui")]
use std::sync::Arc;

#[derive(Debug, Clone)]
pub enum Kind {
    Dir {
        kids: Vec<u32>,
    },
    File {
        offset: u64,
        size: u32,
        stored: u32,
        compressed: bool,
        resource: bool,
        encrypted: bool,
    },
}

#[derive(Debug, Clone)]
pub struct Entry {
    pub name: String,
    pub kind: Kind,
}

impl Entry {
    pub fn is_dir(&self) -> bool {
        matches!(self.kind, Kind::Dir { .. })
    }

    pub fn size(&self) -> u32 {
        match self.kind {
            Kind::File { size, .. } => size,
            _ => 0,
        }
    }
}

pub struct Rpf {
    pub path: PathBuf,
    pub entries: Vec<Entry>,
    pub version: super::format::Version,
    pub(crate) backend: Option<Backend>,
}

pub(crate) enum Backend {
    #[cfg(feature = "gui")]
    GtaV {
        archive: rpf_archive::RpfArchive,
        data: Arc<memmap2::Mmap>,
        keys: Option<Arc<rpf_archive::GtaKeys>>,
    },
    #[cfg(feature = "gui")]
    Rdr2 {
        filesystem: Arc<rf_formats::rpf8::Rpf8FileSystem>,
        archive_index: usize,
    },
}
