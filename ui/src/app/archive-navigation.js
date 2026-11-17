export function createArchiveNavigationActions({state, invoke, render}) {
  async function openArchive(index) {
    state.previewRequestId++;
    state.archiveStack = [];
    state.previewOpen = false;
    state.selectedGameFile = null;
    state.gameFilePreview = null;
    state.selectedEntry = null;
    state.preview = null;
    state.busy = true;
    state.error = '';
    state.notice = 'Opening archive…';
    state.globalResults = null;
    state.globalSearchActive = false;
    state.globalSkipped = 0;
    render();
    try {
      state.archive = await invoke('open_archive', {archiveIndex: index});
      state.previewRequestId++;
      state.archiveIndex = index;
      state.directory = 0;
      state.mobilePane = 'files';
      state.selectedEntry = null;
      state.preview = null;
      const archive = state.summary.archives[index];
      if (archive) {
        archive.loaded = true;
        archive.entryCount = state.archive.entries.length;
      }
      state.notice = `${state.archive.entries.length.toLocaleString()} entries`;
    } catch (error) {
      state.error = String(error);
      const archive = state.summary.archives[index];
      if (archive) archive.error = state.error;
    } finally {
      state.busy = false;
      render();
    }
  }

  async function openNestedArchive(entryIndex) {
    if (state.busy || state.archiveIndex === null) return;
    const entry = state.archive?.entries.find((item) => item.index === entryIndex);
    if (!entry || entry.isDir || !entry.name.toLowerCase().endsWith('.rpf'))
      return;

    const requestId = ++state.previewRequestId;
    const parent = {
      archive: state.archive,
      archiveIndex: state.archiveIndex,
      directory: state.directory,
      selectedEntry: state.selectedEntry,
    };
    state.busy = true;
    state.error = '';
    state.notice = `Opening ${entry.name}…`;
    state.preview = null;
    state.previewOpen = false;
    render();
    try {
      const archive = await invoke('open_nested_archive', {
        parentArchiveIndex: parent.archiveIndex,
        entryIndex,
      });
      if (requestId !== state.previewRequestId ||
          state.archiveIndex !== parent.archiveIndex)
        return;
      state.archiveStack.push(parent);
      state.archive = archive;
      state.archiveIndex = archive.index;
      state.directory = 0;
      state.selectedEntry = null;
      state.filter = '';
      state.globalResults = null;
      state.globalSearchActive = false;
      state.globalSkipped = 0;
      state.mobilePane = 'files';
      state.notice = `${archive.entries.length.toLocaleString()} entries`;
    } catch (error) {
      if (requestId === state.previewRequestId) {
        state.selectedEntry = entryIndex;
        state.error = String(error).replace(/^Error:\s*/, '');
      }
    } finally {
      if (requestId === state.previewRequestId) {
        state.busy = false;
        render();
      }
    }
  }

  function openDirectory(item) {
    if (!item?.isDir) return;
    state.previewRequestId++;
    state.directory = item.index;
    state.selectedEntry = null;
    state.preview = null;
    state.previewOpen = false;
    state.filter = '';
    render();
  }

  async function goUpDirectory(parentDirectory) {
    if (parentDirectory) {
      state.directory = parentDirectory.index;
    } else {
      const previous = state.archiveStack.pop();
      if (!previous) return;
      state.previewRequestId++;
      try {
        await invoke('close_nested_archives', {
          keepArchiveIndex: previous.archiveIndex,
        });
      } catch (error) {
        state.error = String(error).replace(/^Error:\s*/, '');
      }
      state.archive = previous.archive;
      state.archiveIndex = previous.archiveIndex;
      state.directory = previous.directory;
      state.selectedEntry = previous.selectedEntry;
    }
    state.previewRequestId++;
    state.preview = null;
    state.previewOpen = false;
    state.filter = '';
    render();
  }

  return {goUpDirectory, openArchive, openDirectory, openNestedArchive};
}
