mod archive;
mod entry;
mod files;
mod format;

#[cfg(all(feature = "gui", test))]
pub(crate) use entry::Backend;
pub use entry::Rpf;
#[cfg(feature = "gui")]
pub use entry::{Entry, Kind};
pub use format::{decrypt_toc, inspect, ArchiveInfo, Key, Version};
