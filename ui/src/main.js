import './style.css';

import {invoke, isTauri} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {LogicalSize} from '@tauri-apps/api/dpi';
import {
  isNativeModelPayload,
  mountModelViewer,
  mountNativeModelViewer,
  renderModelPreview,
} from './model-viewer.js';
import {highlightText} from './syntax-highlight.js';
import {escapeHtml, fileType, humanSize} from './utils.js';

const games = [
  {
    id: 'max-payne-3',
    name: 'Max Payne 3',
    image: 'https://cdn.veyvy.space/data/scdb/screen/mp3.jpg'
  },
  {
    id: 'gta-iv',
    name: 'GTA IV',
    image: 'https://cdn.veyvy.space/data/scdb/screen/gtaiv.jpg'
  },
  {
    id: 'gta-v',
    name: 'GTA V',
    image: 'https://cdn.veyvy.space/data/scdb/screen/gtav_enhanced.jpg'
  },
  {
    id: 'rdr1',
    name: 'Red Dead Redemption',
    image: 'https://cdn.veyvy.space/data/scdb/screen/rdr.jpeg'
  },
  {
    id: 'rdr2',
    name: 'Red Dead Redemption 2',
    image: 'https://cdn.veyvy.space/data/scdb/screen/rdr2.jpg'
  },
];

const windowSizes = {
  menu: new LogicalSize(1100, 500),
  explorer: new LogicalSize(1280, 820),
};

const state = {
  summary: null,
  selectedGame: null,
  archive: null,
  archiveIndex: null,
  archiveStack: [],
  directory: 0,
  selectedEntry: null,
  selectedGameFile: null,
  gameFilePreview: null,
  preview: null,
  previewOpen: false,
  previewRequestId: 0,
  filter: '',
  globalResults: null,
  globalSearchActive: false,
  globalSkipped: 0,
  gameTree: new Map(),
  expandedGameDirectories: new Set(['']),
  gameTreeGeneration: 0,
  busy: false,
  progress: null,
  gameLoadProgress: null,
  error: '',
  notice: '',
  mobilePane: 'archives',
};

const app = document.querySelector('#app');
let disposeModelViewer = null;
const icon = (type, label = '') => {
  const drawings = {
    folder: '<path d="M2.5 5.5h5l1.5 1.7h7.5v7.3h-14z"/><path d="M2.5 5.5v-2h5l1.5 2"/>',
    xml: '<path d="m7 7-3 3 3 3M11 7l3 3-3 3"/>',
    json: '<path d="M7 6.5c-1.5 0-1.5 1-1.5 2v1c0 1-.5 1.5-1.5 1.5 1 0 1.5.5 1.5 1.5v1c0 1 .5 2 1.5 2M11 6.5c1.5 0 1.5 1 1.5 2v1c0 1 .5 1.5 1.5 1.5-1 0-1.5.5-1.5 1.5v1c0 1-.5 2-1.5 2"/>',
    image: '<rect x="3" y="4" width="10" height="9" rx="1"/><circle cx="6.3" cy="7" r="1"/><path d="m4 12 3-3 2 2 1.5-1.5L13 12"/>',
    audio: '<path d="M9 12V4l5-1v8"/><circle cx="6.5" cy="12.5" r="2"/><circle cx="11.5" cy="11.5" r="2"/>',
    resource: '<path d="m8 2.5 5 2.8v5.5l-5 2.8-5-2.8V5.3z"/><path d="m3.3 5.5 4.7 2.7 4.7-2.7M8 8.2v5.2"/>',
    text: '<path d="M4 5h8M4 8h8M4 11h6"/>',
    file: '<path d="M4 2.5h5l3 3v8H4z"/><path d="M9 2.8v3h2.8"/>',
  };
  const shape = drawings[type] || drawings.file;
  return `<svg class="file-mark file-mark-${type}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shape}</svg>${label}`;
};
function render() {
  disposeModelViewer?.();
  disposeModelViewer = null;
  if (!state.summary?.gameId)
    renderHome();
  else
    renderExplorer();
}

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

function renderHome() {
  const loadingGame = games.find((game) => game.id === state.selectedGame);
  if (state.busy && loadingGame) {
    const progress = state.gameLoadProgress || {
      stage: 'Preparing',
      message: 'Choose the game folder to begin.',
      progress: null,
    };
    const percent = Number.isFinite(progress.progress) ?
        Math.max(0, Math.min(100, progress.progress)) :
        null;
    app.innerHTML = `
      <section class="welcome">
        <main class="game-load-screen" aria-busy="true">
          <img class="game-load-art" src="${loadingGame.image}" alt="" draggable="false">
          <section class="game-load-panel" aria-label="Loading ${escapeHtml(loadingGame.name)}">
            <p class="game-load-overline">GAME LOAD</p>
            <h1>${escapeHtml(loadingGame.name)}</h1>
            <div class="game-load-status" role="status" aria-live="polite">
              <span class="game-load-stage" data-load-stage>${escapeHtml(progress.stage || 'Loading')}</span>
              <p data-load-message>${escapeHtml(progress.message || 'Loading game files…')}</p>
            </div>
            <div class="game-load-progress-row">
              <div class="game-load-progress${percent === null ? ' is-indeterminate' : ''}"
                role="progressbar" aria-label="Game loading progress"
                aria-valuemin="0" aria-valuemax="100"
                ${percent === null ? 'aria-valuetext="Progress not currently measurable"' : `aria-valuenow="${percent}"`}>
                <span data-load-bar ${percent === null ? '' : `style="width: ${percent}%"`}></span>
              </div>
              <span class="game-load-percent" data-load-percent>${percent === null ? 'Working…' : `${percent}%`}</span>
            </div>
          </section>
        </main>
      </section>`;
    return;
  }

  app.innerHTML = `
    <section class="welcome">
      <main class="library-page" aria-busy="${state.busy}">
        <div class="game-grid" role="group" aria-label="Choose a supported game">
          ${games.map((game) => `
            <button class="game-card" type="button" data-game="${game.id}"
              aria-label="${escapeHtml(game.name)}" ${state.busy ? 'disabled' : ''}>
              <img class="game-card-art" src="${game.image}" alt="" draggable="false">
            </button>`).join('')}
        </div>
        <span class="sr-only" role="status" aria-live="polite">${
      state.busy ? 'Choose a game folder.' : ''}</span>
        ${state.error ? `<p class="home-error" role="alert">${escapeHtml(state.error)}</p>` : ''}
      </main>
    </section>`;

  app.querySelectorAll('[data-game]').forEach((button) =>
    button.addEventListener('click', () => chooseFolder(button.dataset.game)));
}

async function resizeWindow(size) {
  if (!isTauri()) return;
  try {
    await getCurrentWindow().setSize(size);
  } catch (error) {
    console.error('Unable to resize the application window:', error);
  }
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

function renderExplorer() {
  const summary = state.summary;
  const archive = state.archive;
  const current =
      archive?.entries.find((entry) => entry.index === state.directory);
  const children =
      archive?.entries.filter((entry) => entry.parent === state.directory) ||
      [];
  const filterQuery = state.filter.trim().toLowerCase();
  const filtered = filterQuery ?
      archive?.entries.filter(
          (entry) => entry.index !== 0 &&
              entry.path.toLowerCase().includes(filterQuery)) ||
          [] :
      children;
  const selected =
      archive?.entries.find((entry) => entry.index === state.selectedEntry);
  const parentDirectory = current?.index && current.index !== 0 ?
      archive?.entries.find((entry) => entry.index === current.parent) :
      null;
  const gameFolderName =
      summary.root.split(/[\\/]/).filter(Boolean).pop() || summary.gameName;
  const archiveName = archive?.path.split('/').pop();

  app.innerHTML = `
    <section class="workspace mobile-${state.mobilePane}">
      <header class="toolbar">
        <div class="explorer-navigation">
          <button class="back-button" id="back-games" title="Back to game library" aria-label="Back to game library">‹</button>
          <button class="button subtle nav-button" id="up-directory" aria-label="${
      parentDirectory ? 'Go up one level' : 'Return to parent archive'}" title="${
      parentDirectory ? 'Go up one level' : 'Return to parent archive'}" ${
      !parentDirectory && !state.archiveStack.length ? 'disabled' : ''}>${
      parentDirectory ? '↑' : state.archiveStack.length ? '↩' : '↑'}</button><span class="crumb-slash">/</span><strong>${
      escapeHtml(summary.gameName)}</strong>
        </div>
        <div class="addressbar" title="${escapeHtml(summary.root)}">
          <span class="address-place">This PC</span><span class="address-separator">›</span>
          <span class="address-place">${escapeHtml(gameFolderName)}</span>
          ${
      archive ?
          `<span class="address-separator">›</span><span class="address-place">${escapeHtml(archiveName)}</span><span class="address-subpath">${crumbsHtml(archive, state.directory)}</span>` :
          '<span class="address-separator">›</span><span class="address-place">Select an archive</span>'}
        </div>
        <div class="toolbar-actions">
          <button class="button subtle" id="open-folder">Choose folder…</button>
        </div>
      </header>
      <div class="commandbar">
        <label class="searchbox"><span aria-hidden="true">⌕</span><input id="filter" type="search" placeholder="Search in current archive" value="${
      escapeHtml(state.filter)}" ${state.busy ? 'disabled' : ''} /><kbd>Enter · all archives</kbd></label>
        <div class="command-actions">
          <button class="button index-button ${state.globalSearchActive ? 'is-active' : ''} ${
      state.busy && state.progress ? 'is-searching' : ''}" id="index-all" aria-pressed="${
      state.globalSearchActive}" aria-label="Index and search all archives" title="Search filenames across all archives; results are limited to 1,000" ${
      state.busy ? 'disabled' : ''}><span class="index-glyph" aria-hidden="true">${
      state.busy && state.progress ? '◌' : '⌕'}</span> ${
      state.busy && state.progress ? 'Searching archives…' :
          state.busy ? 'Working…' :
          state.globalSearchActive ? 'Search again' : 'Search all archives'}</button>
        </div>
        <nav class="mobile-tabs" aria-label="Explorer views">
          <button class="${state.mobilePane === 'archives' ? 'active' : ''}" data-pane="archives">Folders</button>
          <button class="${state.mobilePane === 'files' ? 'active' : ''}" data-pane="files" ${
      !archive ? 'disabled' : ''}>Files</button>
          <button class="${state.mobilePane === 'inspector' ? 'active' : ''}" data-pane="inspector" ${
      state.selectedEntry === null ? 'disabled' : ''}>Details</button>
        </nav>
      </div>
      <div class="progress-strip ${state.progress ? 'visible' : ''}" role="progressbar" aria-label="Archive indexing progress" aria-valuemin="0" aria-valuemax="${
      state.progress?.total || summary.archives.length}" aria-valuenow="${
      state.progress?.completed || 0}"><span style="width:${
              state.progress?.total ?
                  Math.min(
                      100,
                      state.progress.completed / state.progress.total * 100) :
                  0}%"></span></div>
      <div class="workarea">
        <aside class="archive-panel">
          <div class="panel-heading"><div><span class="section-label">GAME FOLDER</span><h2>${escapeHtml(gameFolderName)}</h2></div></div>
          <div class="archive-list game-tree" role="tree" aria-label="Game folder contents">
            ${renderGameDirectory('', 0, summary)}
          </div>
          <div class="library-status"><span class="status-dot"></span><span>${
      escapeHtml(summary.status)}</span></div>
        </aside>
        <section class="file-panel">
          <div class="file-heading">
            <div class="file-heading-copy">
              <h2>${
      state.globalSearchActive ?
                  `Results${state.filter ? ` for “${escapeHtml(state.filter)}”` : ''}` :
                  archive                ? escapeHtml(current?.name || archive.path.split('/').pop()) :
                                           'Select an archive'}</h2></div>
            <span class="item-count">${
      state.globalSearchActive ? `${state.globalResults?.length || 0} items` :
          archive ? `${filtered.length} items` : ''}</span>
          </div>
          ${state.globalSearchActive ? `<div class="global-search-state ${state.busy ? 'is-searching' : 'is-complete'}"><span class="global-search-icon">${state.busy ? '◌' : '⌕'}</span><span class="global-search-copy"><strong>${state.busy ? 'Searching all archives' : 'Global archive search'}</strong><small>${state.busy ? `Scanned ${state.progress?.completed || 0} of ${state.progress?.total || summary.archives.length} archives · ${state.progress?.matches || 0} matches so far` : `${state.globalResults?.length || 0} results${state.globalSkipped ? ` · ${state.globalSkipped} skipped` : ''}${state.globalResults?.length === 1000 ? ' · result limit reached' : ''}`}</small></span><button class="clear-search" id="clear-global-search" ${state.busy ? 'disabled' : ''}>Back to files</button></div>` : ''}
          ${
      state.globalSearchActive ?
                                 renderGlobalResults() :
                                 archive ?
                                 renderFileTable(filtered) :
                                 renderEmpty(
              'Open an archive',
              'Choose an archive from the library to browse its contents.')}
        </section>
        <aside class="inspector-panel">
          <div class="inspector-title"><span class="section-label">INSPECTOR</span><span class="inspect-menu">${
      selected ? fileType(selected.name) : '—'}</span></div>
          ${
      selected ?
                                 renderInspector(selected, archive) :
                                 renderEmpty(
              'Nothing selected',
              'Select an item to inspect its details or preview its contents.')}
        </aside>
      </div>
      <footer class="statusbar"><span class="status-message ${
      state.error ? 'error-text' : ''}">${
      escapeHtml(state.error || state.notice || 'Ready')}</span><span>${
      state.progress ?
                                 `${state.progress.completed} / ${state.progress.total} indexed · ${
              state.progress.matches} matches${
              state.progress.failed ? ` · ${state.progress.failed} skipped` :
                                                             ''}` :
                                                             `${summary.archives.length} archives`}</span></footer>
    </section>
    ${
      state.previewOpen && state.selectedGameFile ?
          renderPreviewDialog(state.selectedGameFile, state.gameFilePreview) :
          state.previewOpen && selected && !selected.isDir ?
              renderPreviewDialog(selected, state.preview) :
              ''}`;

  app.querySelector('#back-games').addEventListener('click', () => {
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
  });
  app.querySelector('#open-folder').addEventListener('click', chooseFolder);
  app.querySelector('#up-directory')?.addEventListener('click', async () => {
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
  });
  app.querySelector('#index-all').addEventListener('click', searchAll);
  app.querySelector('#clear-global-search')?.addEventListener('click', () => {
    state.globalResults = null;
    state.globalSearchActive = false;
    state.globalSkipped = 0;
    state.filter = '';
    state.mobilePane = archive ? 'files' : 'archives';
    render();
  });
  app.querySelectorAll('[data-pane]').forEach((button) => button.addEventListener('click', () => {
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
      .forEach(
          (button) => button.addEventListener(
              'click', () => toggleGameDirectory(button.dataset.gameDir)));
  app.querySelectorAll('[data-game-archive]')
      .forEach(
          (button) => button.addEventListener(
              'click', () => openArchive(Number(button.dataset.gameArchive))));
  app.querySelectorAll('[data-game-file]')
      .forEach(
          (button) => button.addEventListener(
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
      .forEach(
          (button) => button.addEventListener(
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
      .forEach(
          (button) => button.addEventListener(
              'click', () => selectResult(Number(button.dataset.result))));
  app.querySelector('#extract-entry')?.addEventListener('click', extractEntry);
  app.querySelector('#extract-folder')
      ?.addEventListener('click', extractFolder);
  const previewDialog = app.querySelector('#preview-dialog');
  previewDialog?.querySelector('#preview-dialog-close')
      ?.addEventListener('click', closePreview);
  previewDialog?.addEventListener('cancel', (event) => {
    event.preventDefault();
    closePreview();
  });
  previewDialog?.addEventListener('click', (event) => {
    if (event.target === previewDialog) closePreview();
  });
  previewDialog?.querySelector('[data-model-drawable]')
      ?.addEventListener('change', (event) => {
        void selectModelDrawable(Number(event.target.value));
      });
  if (state.previewOpen && previewDialog && !previewDialog.open)
    previewDialog.showModal();
  const previewEntry = state.selectedGameFile ||
      state.archive?.entries.find((entry) => entry.index === state.selectedEntry);
  const preview = state.selectedGameFile ? state.gameFilePreview : state.preview;
  if (state.previewOpen && preview?.kind === 'model' &&
      !isNativeModelPayload(preview))
    disposeModelViewer = mountModelViewer(previewDialog, preview);
  else if (state.previewOpen && preview?.kind === 'model')
    mountNativeModelViewer(previewDialog, preview);
}

function renderFileTable(entries) {
  if (!entries.length)
    return renderEmpty(
        'No matching files',
        state.filter ? 'Try a different name or search all archives.' :
                       'This folder is empty.');
  return `<div class="table-wrap"><table class="file-table"><thead><tr>  <th>Name</th><th>Size</th><th>Details</th></tr></thead><tbody>${
      entries
          .map(
              (entry) => `
    <tr class="${
                  entry.index === state.selectedEntry ?
                      'selected' :
                      ''}" data-entry="${entry.index}">
      <td><button class="file-name" ${
                  entry.isDir ?
                      `aria-label="Open folder ${escapeHtml(entry.name)}" aria-keyshortcuts="Enter"` :
                      ''}>${
                  icon(
                      entry.isDir ? 'folder' : markFor(entry.name),
                      escapeHtml(entry.name))}</button></td>
      <td class="size-cell">${entry.isDir ? '—' : humanSize(entry.size)}</td>
      <td class="details-cell">${
                  entry.isDir ? '—' :
                      [
                        entry.resource && 'Resource',
                        entry.compressed && 'Compressed',
                        entry.encrypted && 'Encrypted'
                      ].filter(Boolean).join(' · ') || '—'}</td>
    </tr>`)
          .join('')}</tbody></table></div>`;
}

function renderGameDirectory(path, depth, summary) {
  const directory = state.gameTree.get(path);
  if (!directory)
    return `<div class="game-tree-message" role="status">Expand a folder to view its contents.</div>`;
  if (directory.loading && !directory.entries)
    return `<div class="game-tree-message" role="status">Loading folder contents…</div>`;
  if (directory.error)
    return `<div class="game-tree-message game-tree-error" role="alert">${escapeHtml(directory.error)}</div>`;
  if (!directory.entries?.length)
    return `<div class="game-tree-message">This folder is empty.</div>`;

  return directory.entries.map((entry) => {
    const expanded = state.expandedGameDirectories.has(entry.path);
    const padding = 8 + depth * 14;
    if (entry.isDir) {
      return `<div class="game-tree-node"><button class="game-tree-item is-folder" role="treeitem" aria-level="${depth + 1}" aria-expanded="${expanded}" data-game-dir="${escapeHtml(entry.path)}" style="padding-left:${padding}px"><span class="game-tree-toggle" aria-hidden="true">${expanded ? '⌄' : '›'}</span>${icon('folder')}<span class="game-tree-name" title="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</span></button>${expanded ? `<div class="game-tree-children" role="group">${renderGameDirectory(entry.path, depth + 1, summary)}</div>` : ''}</div>`;
    }

    const archiveIndex = entry.isArchive ?
        summary.archives.findIndex(
            (archive) => archive.path.replace(/\\/g, '/') === entry.path) :
        -1;
    const type = markFor(entry.name);
    const label = `<span class="game-tree-name" title="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</span>`;
    const active = archiveIndex >= 0 ?
        state.archiveIndex === archiveIndex :
        state.selectedGameFile?.path === entry.path;
    const button = archiveIndex >= 0 ?
        `<button class="game-tree-item is-file is-archive${active ? ' active' : ''}" role="treeitem" aria-level="${depth + 1}" data-game-archive="${archiveIndex}" style="padding-left:${padding + 18}px">${icon(type)}${label}</button>` :
        `<button class="game-tree-item is-file game-tree-openable${active ? ' active' : ''}" role="treeitem" aria-level="${depth + 1}" data-game-file="${escapeHtml(entry.path)}" aria-label="Open ${escapeHtml(entry.name)}" style="padding-left:${padding + 18}px">${icon(type)}${label}</button>`;
    return `<div class="game-tree-node">${button}</div>`;
  }).join('');
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

function renderGlobalResults() {
  if (state.busy && !state.globalResults)
    return `<div class="empty-state"><span class="loading-ring"></span><h3>Searching archive contents</h3><p>${
        state.progress ? `Scanning archive ${state.progress.completed} of ${
                             state.progress.total}…` :
                         'Opening archives as needed…'}</p></div>`;
  if (!state.globalResults?.length)
    return renderEmpty(
        'No results found', 'Try another filename or search term.');
  return `<div class="table-wrap"><table class="file-table results-table"><thead><tr><th>FILE</th><th>ARCHIVE</th><th>SIZE</th></tr></thead><tbody>${
      state.globalResults
          .map(
              (item, index) => `
    <tr data-result="${index}"><td><button class="file-name">${
                  icon(
                      markFor(item.name),
                      `<span>${
                          escapeHtml(item.name)}<small class="result-path">${
                          escapeHtml(
                              item.path)}</small></span>`)}</button></td><td class="archive-result">${
                  escapeHtml(item.archive.split('/')
                                 .pop())}</td><td class="size-cell">${
                  humanSize(item.size)}</td></tr>`)
          .join('')}</tbody></table></div>`;
}

function renderInspector(entry, archive) {
  const details = `
    <div class="metadata">
      <div><span>Archive</span><strong>${
      escapeHtml(archive.path.split('/').pop())}</strong></div>
      <div><span>Path</span><strong title="${escapeHtml(entry.path)}">${
      escapeHtml(entry.path)}</strong></div>
      <div><span>File size</span><strong>${
      humanSize(entry.size)}</strong></div>
      ${
      !entry.isDir ?
          `<div><span>Stored</span><strong>${
              humanSize(entry.stored)}</strong></div>
      <div><span>Compression</span><strong>${
              entry.compressed ? 'Compressed' : 'Uncompressed'}</strong></div>
      <div><span>Flags</span><strong>${
                  [entry.resource && 'Resource', entry.encrypted && 'Encrypted']
                      .filter(Boolean)
                      .join(' · ') ||
              'None'}</strong></div>` :
          ''}
    </div>
    <div class="inspector-actions">
      ${
      entry.isDir ?
          `<button class="button primary small" id="extract-folder">Extract folder</button>` :
          `<button class="button primary small" id="extract-entry">Extract file</button>`}
    </div>`;
  return `<div class="inspector-content">
    <div class="selected-file">${
      icon(entry.isDir ? 'folder' : markFor(entry.name))}<div><h3 title="${
      escapeHtml(entry.name)}">${escapeHtml(entry.name)}</h3><span>${
      entry.isDir ? 'Folder' : fileType(entry.name)}</span></div></div>
    ${details}
  </div>`;
}

function renderPreviewDialog(entry, preview = null) {
  const modelWorkspace = preview?.kind === 'model' ||
      /\.(?:obj|gltf|glb|ydr|ydd|yft)$/i.test(entry.name);
  return `<dialog class="preview-dialog${modelWorkspace ? ' is-model-workspace' : ''}" id="preview-dialog" aria-modal="true" aria-labelledby="preview-dialog-title" aria-describedby="preview-dialog-path">
    <div class="preview-dialog-panel">
      <header class="preview-dialog-header">
        <div class="preview-dialog-title">
          <span class="section-label">ASSET PREVIEW</span>
          <h2 id="preview-dialog-title">${escapeHtml(entry.name)}</h2>
          <p id="preview-dialog-path" title="${escapeHtml(entry.path)}">${escapeHtml(entry.path)}</p>
        </div>
        <button class="button subtle preview-dialog-close" id="preview-dialog-close" aria-label="Close preview" autofocus>Close <span aria-hidden="true">×</span></button>
      </header>
      <div class="preview-dialog-content" aria-live="polite" aria-busy="${
      !preview}">${renderPreview(preview)}</div>
      <footer class="preview-dialog-footer"><span>${fileType(entry.name)} · ${humanSize(entry.size)}</span><span>ESC TO CLOSE</span></footer>
    </div>
  </dialog>`;
}

function renderPreview(preview) {
  if (!preview)
    return `<div class="preview-loading" role="status"><span class="loading-ring" aria-hidden="true"></span><span>Preparing preview…</span></div>`;
  if (preview.kind === 'model')
    return renderModelPreview(preview);
  if (preview.kind === 'image')
    return `<div class="image-preview"><img src="${
        escapeHtml(preview.content)}" alt="Preview of ${
        escapeHtml(preview.name)}" /></div>`;
  if (preview.kind === 'text')
    return `<pre class="text-preview">${highlightText(
        preview.content, preview.name)}</pre>`;
  return `<div class="unsupported-preview"><span class="preview-mark">PREVIEW</span><p>${
      escapeHtml(preview.content)}</p></div>`;
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
function renderEmpty(title, description) {
  return `<div class="empty-state"><span class="empty-glyph" aria-hidden="true">R</span><h3>${
      title}</h3><p>${description}</p></div>`;
}

function crumbsHtml(archive, directory) {
  const chain = [];
  let current = archive.entries.find((entry) => entry.index === directory);
  while (current && current.index !== 0) {
    chain.unshift(current);
    current = archive.entries.find((entry) => entry.index === current.parent);
  }
  return `<button data-directory="0">/</button>${
      chain
          .map(
              (entry) => `<span>/</span><button data-directory="${
                  entry.index}">${escapeHtml(entry.name)}</button>`)
          .join('')}`;
}

function markFor(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (ext === 'xml' || ext === 'html' || ext === 'htm') return 'xml';
  if (ext === 'json') return 'json';
  if (['png', 'jpg', 'jpeg', 'dds'].includes(ext)) return 'image';
  if (['wav', 'mp3', 'awc', 'ogg', 'bik'].includes(ext)) return 'audio';
  if (['ydr', 'ydd', 'yft', 'wdr', 'wft', 'wtd'].includes(ext)) return 'resource';
  if ([
        'txt', 'csv', 'ini', 'cfg', 'meta', 'dat', 'ide', 'ipl', 'lua', 'fx'
      ].includes(ext))
    return 'text';
  return 'file';
}

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
    const preview =
        await invoke('preview_entry', {
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

async function searchAll() {
  state.globalResults = null;
  state.globalSearchActive = true;
  state.globalSkipped = 0;
  state.mobilePane = 'files';
  state.progress = {
    completed: 0,
    total: state.summary.archives.length,
    matches: 0,
    failed: 0
  };
  state.busy = true;
  state.error = '';
  render();
  try {
    const response = await invoke('index_archives', {query: state.filter});
    state.globalResults = response.results;
    state.globalSkipped = response.skippedArchives;
    state.notice = `${state.globalResults.length.toLocaleString()} result${
        state.globalResults.length === 1 ? '' : 's'}${
        state.globalResults.length === 1000 ? ' · 1,000 result limit reached' :
                                              ''}${
        response.skippedArchives ?
            ` · ${response.skippedArchives} archive(s) could not be opened` :
            ''}`;
  } catch (error) {
    state.error = String(error);
  } finally {
    state.busy = false;
    state.progress = null;
    render();
  }
}

async function selectResult(index) {
  const result = state.globalResults[index];
  if (!result) return;
  await openArchive(result.archiveIndex);
  const item =
      state.archive?.entries.find((entry) => entry.index === result.entryIndex);
  state.directory = item?.isDir ? item.index : (item?.parent ?? 0);
  state.globalSearchActive = false;
  state.globalResults = null;
  state.mobilePane = 'inspector';
  await selectEntry(result.entryIndex);
}

async function extractEntry() {
  try {
    state.notice = await invoke(
        'extract_file',
        {archiveIndex: state.archiveIndex, entryIndex: state.selectedEntry});
    state.error = '';
  } catch (error) {
    state.error = String(error);
  }
  render();
}

async function extractFolder() {
  try {
    state.notice = await invoke(
        'extract_folder',
        {archiveIndex: state.archiveIndex, entryIndex: state.selectedEntry});
    state.error = '';
  } catch (error) {
    state.error = String(error);
  }
  render();
}

const gameLoadProgressReady = listen('game-load-progress', (event) => {
  const progress = event.payload;
  if (!state.busy || progress.gameId !== state.selectedGame) return;

  const value = Number.isFinite(progress.progress) ?
      Math.max(0, Math.min(100, progress.progress)) :
      null;
  const previous = state.gameLoadProgress;
  if (previous?.stage === progress.stage &&
      Number.isFinite(previous.progress) &&
      value !== null &&
      value < previous.progress)
    return;
  state.gameLoadProgress = {...progress, progress: value};
  const stage = app.querySelector('[data-load-stage]');
  const message = app.querySelector('[data-load-message]');
  const bar = app.querySelector('[data-load-bar]');
  const progressBar = app.querySelector('.game-load-progress');
  const label = app.querySelector('[data-load-percent]');
  if (stage) stage.textContent = progress.stage || 'Loading';
  if (message) message.textContent = progress.message || 'Loading game files…';
  if (bar) {
    bar.style.width = value === null ? '' : `${value}%`;
    bar.parentElement?.classList.toggle('is-indeterminate', value === null);
  }
  if (progressBar) {
    if (value === null) {
      progressBar.removeAttribute('aria-valuenow');
      progressBar.setAttribute(
          'aria-valuetext', 'Progress not currently measurable');
    } else {
      progressBar.setAttribute('aria-valuenow', String(value));
      progressBar.setAttribute('aria-valuetext', `${value}% complete`);
    }
  }
  if (label)
    label.textContent = value === null ? 'Working…' : `${value}%`;
}).catch((error) => {
  console.error('Unable to listen for game loading progress:', error);
  return () => {};
});

listen('index-progress', (event) => {
  state.progress = event.payload;
  const progress = state.progress;
  const bar = app.querySelector('.progress-strip span');
  if (bar)
    bar.style.width = `${
        progress.total ?
            Math.min(100, progress.completed / progress.total * 100) :
            0}%`;
  const progressBar = app.querySelector('.progress-strip');
  progressBar?.setAttribute('aria-valuemax', String(progress.total));
  progressBar?.setAttribute('aria-valuenow', String(progress.completed));
  const searchState = app.querySelector('.global-search-copy small');
  if (searchState)
    searchState.textContent =
        `Scanned ${progress.completed} of ${progress.total} archives · ${
            progress.matches} matches so far`;
  const label = app.querySelector('.statusbar > span:last-child');
  if (label)
    label.textContent = `${progress.completed} / ${progress.total} indexed · ${
        progress.matches} matches${
        progress.failed ? ` · ${progress.failed} skipped` : ''}`;
});

invoke('get_summary')
    .then(async (summary) => {
      state.summary = summary.gameId ? summary : null;
      void resizeWindow(
          summary.gameId ? windowSizes.explorer : windowSizes.menu);
      if (state.summary) {
        state.gameTreeGeneration++;
        state.gameTree = new Map([['', {loading: true, entries: null, error: ''}]]);
        state.expandedGameDirectories = new Set(['']);
      }
      render();
      if (state.summary) await loadGameDirectory('');
    })
    .catch((error) => {
      state.error = String(error).replace(/^Error:\s*/, '');
      render();
    });
