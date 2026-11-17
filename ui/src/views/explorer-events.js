export function bindExplorerEvents({
  app,
  state,
  archive,
  parentDirectory,
  render,
  actions,
}) {
  const {
    returnToLibrary,
    chooseFolder,
    goUpDirectory,
    searchAll,
    toggleGameDirectory,
    openArchive,
    openGameFile,
    openNestedArchive,
    openDirectory,
    selectEntry,
    selectResult,
    extractEntry,
    extractFolder,
  } = actions;

  app.querySelector('#back-games').addEventListener('click', returnToLibrary);
  app.querySelector('#open-folder').addEventListener('click', chooseFolder);
  app.querySelector('#up-directory')
      ?.addEventListener('click', () => goUpDirectory(parentDirectory));
  app.querySelector('#index-all').addEventListener('click', searchAll);
  app.querySelector('#clear-global-search')?.addEventListener('click', () => {
    state.globalResults = null;
    state.globalSearchActive = false;
    state.globalSkipped = 0;
    state.filter = '';
    state.mobilePane = archive ? 'files' : 'archives';
    render();
  });
  app.querySelectorAll('[data-pane]').forEach((button) =>
    button.addEventListener('click', () => {
      if (button.disabled) return;
      state.mobilePane = button.dataset.pane;
      render();
    }));

  const filterInput = app.querySelector('#filter');
  filterInput.addEventListener('input', (event) => {
    state.filter = event.target.value;
    state.globalResults = null;
    state.globalSearchActive = false;
    state.globalSkipped = 0;
    render();
    const newInput = app.querySelector('#filter');
    newInput.focus();
    newInput.setSelectionRange(newInput.value.length, newInput.value.length);
  });
  filterInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') searchAll();
    if (event.key === 'Escape') {
      state.filter = '';
      state.globalResults = null;
      state.globalSearchActive = false;
      state.globalSkipped = 0;
      render();
    }
  });

  app.querySelectorAll('[data-game-dir]')
      .forEach((button) => button.addEventListener(
          'click', () => toggleGameDirectory(button.dataset.gameDir)));
  app.querySelectorAll('[data-game-archive]')
      .forEach((button) => button.addEventListener(
          'click', () => openArchive(Number(button.dataset.gameArchive))));
  app.querySelectorAll('[data-game-file]')
      .forEach((button) => button.addEventListener(
          'click', () => openGameFile(button.dataset.gameFile)));
  app.querySelectorAll('[data-directory]')
      .forEach((button) => button.addEventListener('click', () => {
        state.directory = Number(button.dataset.directory);
        state.previewRequestId++;
        state.selectedEntry = null;
        state.preview = null;
        state.previewOpen = false;
        state.filter = '';
        state.globalResults = null;
        state.globalSearchActive = false;
        state.globalSkipped = 0;
        state.mobilePane = 'files';
        render();
      }));
  app.querySelectorAll('[data-entry]')
      .forEach((button) => button.addEventListener(
          'click', () => selectEntry(Number(button.dataset.entry))));
  app.querySelectorAll('[data-entry]')
      .forEach((button) => button.addEventListener('dblclick', () => {
        const item = archive?.entries.find(
            (entry) => entry.index === Number(button.dataset.entry));
        openDirectory(item);
      }));
  app.querySelectorAll('[data-entry]')
      .forEach((row) => row.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        const item = archive?.entries.find(
            (entry) => entry.index === Number(row.dataset.entry));
        if (!item) return;
        event.preventDefault();
        if (item.isDir)
          openDirectory(item);
        else if (item.name.toLowerCase().endsWith('.rpf'))
          void openNestedArchive(item.index);
      }));
  app.querySelectorAll('[data-result]')
      .forEach((button) => button.addEventListener(
          'click', () => selectResult(Number(button.dataset.result))));
  app.querySelector('#extract-entry')?.addEventListener('click', extractEntry);
  app.querySelector('#extract-folder')
      ?.addEventListener('click', extractFolder);
}
