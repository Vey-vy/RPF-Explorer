export function createGameLibraryActions({
  state,
  invoke,
  render,
  resizeWindow,
  windowSizes,
  gameLoadProgressReady,
}) {
  async function loadGameDirectory(path) {
    const generation = state.gameTreeGeneration;
    const summaryRoot = state.summary?.root;
    state.gameTree.set(path, {loading: true, entries: null, error: ''});
    render();
    try {
      const entries = await invoke('list_game_directory', {relativePath: path});
      if (generation !== state.gameTreeGeneration ||
          summaryRoot !== state.summary?.root)
        return;
      state.gameTree.set(path, {loading: false, entries, error: ''});
    } catch (error) {
      if (generation !== state.gameTreeGeneration ||
          summaryRoot !== state.summary?.root)
        return;
      const message = error instanceof Error ? error.message : String(error);
      state.gameTree.set(path, {
        loading: false,
        entries: null,
        error: message.replace(/^Error:\s*/, '')
      });
      state.error = message.replace(/^Error:\s*/, '');
    }
    render();
  }

  async function toggleGameDirectory(path) {
    if (state.expandedGameDirectories.has(path)) {
      state.expandedGameDirectories.delete(path);
      render();
      return;
    }
    state.expandedGameDirectories.add(path);
    render();
    const directory = state.gameTree.get(path);
    if (!directory?.entries && !directory?.loading)
      await loadGameDirectory(path);
  }

  async function chooseFolder(gameId = state.selectedGame) {
    if (!gameId || state.busy) return;
    state.selectedGame = gameId;
    state.previewRequestId++;
    state.previewOpen = false;
    state.selectedEntry = null;
    state.preview = null;
    state.busy = true;
    state.gameLoadProgress = {
      stage: 'Preparing',
      message: 'Choose the game folder to begin.',
      progress: null,
    };
    state.error = '';
    render();
    try {
      await gameLoadProgressReady;
      state.summary = await invoke('choose_game_folder', {
        gameId,
        keyInput: null,
      });
      state.gameTreeGeneration++;
      state.gameTree = new Map([['', {loading: true, entries: null, error: ''}]]);
      state.expandedGameDirectories = new Set(['']);
      await resizeWindow(windowSizes.explorer);
      state.archive = null;
      state.archiveIndex = null;
      state.archiveStack = [];
      state.selectedEntry = null;
      state.selectedGameFile = null;
      state.gameFilePreview = null;
      state.preview = null;
      state.previewOpen = false;
      state.filter = '';
      state.globalResults = null;
      state.globalSearchActive = false;
      state.globalSkipped = 0;
      state.mobilePane = 'archives';
      state.notice = state.summary.status;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/folder selection cancelled/i.test(message))
        state.error = message.replace(/^Error:\s*/, '');
    } finally {
      state.busy = false;
      state.gameLoadProgress = null;
      render();
    }
    if (state.summary?.gameId && state.gameTree.get('')?.loading)
      await loadGameDirectory('');
  }

  function returnToLibrary() {
    state.gameTreeGeneration++;
    state.gameTree.clear();
    state.expandedGameDirectories.clear();
    state.previewRequestId++;
    state.summary = null;
    state.archive = null;
    state.archiveStack = [];
    state.selectedEntry = null;
    state.selectedGameFile = null;
    state.gameFilePreview = null;
    state.preview = null;
    state.previewOpen = false;
    state.error = '';
    state.notice = '';
    void resizeWindow(windowSizes.menu);
    render();
  }

  return {
    chooseFolder,
    loadGameDirectory,
    returnToLibrary,
    toggleGameDirectory,
  };
}
