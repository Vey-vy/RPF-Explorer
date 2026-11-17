export function createFilePreviewActions({
  state,
  app,
  invoke,
  render,
  openNestedArchive,
}) {
  function closePreview() {
    if (!state.previewOpen) return;
    state.previewOpen = false;
    render();
    if (state.selectedGameFile) {
      const path = state.selectedGameFile.path;
      [...app.querySelectorAll('[data-game-file]')]
          .find((button) => button.dataset.gameFile === path)?.focus();
      return;
    }
    app.querySelector(`[data-entry="${state.selectedEntry}"] .file-name`)?.focus();
  }

  async function openGameFile(path) {
    const entry = [...state.gameTree.values()]
        .flatMap((directory) => directory.entries || [])
        .find((item) => item.path === path && !item.isDir);
    if (!entry) return;

    const requestId = ++state.previewRequestId;
    const summaryRoot = state.summary?.root;
    state.selectedEntry = null;
    state.selectedGameFile = entry;
    state.gameFilePreview = null;
    state.previewOpen = true;
    state.error = '';
    render();
    try {
      const preview = await invoke(
          'preview_game_file', {relativePath: path, drawableIndex: null});
      if (requestId !== state.previewRequestId ||
          summaryRoot !== state.summary?.root ||
          state.selectedGameFile?.path !== path)
        return;
      state.gameFilePreview = preview;
    } catch (error) {
      if (requestId !== state.previewRequestId ||
          summaryRoot !== state.summary?.root ||
          state.selectedGameFile?.path !== path)
        return;
      const message = error instanceof Error ? error.message : String(error);
      state.gameFilePreview = {
        name: entry.name,
        kind: 'note',
        content: message.replace(/^Error:\s*/, '')
      };
    }
    render();
  }

  async function selectEntry(index) {
    const entry = state.archive?.entries.find((item) => item.index === index);
    if (entry && !entry.isDir && entry.name.toLowerCase().endsWith('.rpf')) {
      await openNestedArchive(index);
      return;
    }
    const requestId = ++state.previewRequestId;
    const archiveIndex = state.archiveIndex;
    state.selectedGameFile = null;
    state.gameFilePreview = null;
    state.selectedEntry = index;
    state.mobilePane = 'inspector';
    state.preview = null;
    state.previewOpen = Boolean(entry && !entry.isDir);
    render();
    if (!entry || entry.isDir) return;
    try {
      const preview = await invoke('preview_entry', {
        archiveIndex,
        entryIndex: index,
        drawableIndex: null
      });
      if (requestId !== state.previewRequestId ||
          archiveIndex !== state.archiveIndex ||
          index !== state.selectedEntry)
        return;
      state.preview = preview;
    } catch (error) {
      if (requestId !== state.previewRequestId ||
          archiveIndex !== state.archiveIndex ||
          index !== state.selectedEntry)
        return;
      state.preview = {kind: 'note', content: String(error)};
    }
    render();
  }

  async function selectModelDrawable(drawableIndex) {
    const gameFile = state.selectedGameFile;
    const selectedEntry = state.selectedEntry;
    const archiveIndex = state.archiveIndex;
    const requestId = ++state.previewRequestId;
    const args = gameFile ?
        {relativePath: gameFile.path, drawableIndex} :
        {archiveIndex, entryIndex: selectedEntry, drawableIndex};
    try {
      const preview = await invoke(
          gameFile ? 'preview_game_file' : 'preview_entry', args);
      if (requestId !== state.previewRequestId ||
          (gameFile ? state.selectedGameFile?.path !== gameFile.path :
                      state.selectedEntry !== selectedEntry ||
                          state.archiveIndex !== archiveIndex))
        return;
      if (gameFile)
        state.gameFilePreview = preview;
      else
        state.preview = preview;
      render();
    } catch (error) {
      if (requestId !== state.previewRequestId) return;
      const status = app.querySelector('[data-native-model-status]');
      if (status) status.textContent = `Could not render drawable: ${String(error)}`;
    }
  }

  return {closePreview, openGameFile, selectEntry, selectModelDrawable};
}
