import './style.css';

import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';

const games = [
  {
    id: 'max-payne-3',
    name: 'Max Payne 3',
    formats: 'RPF4',
    detail: 'Manual key or executable scan'
  },
  {
    id: 'gta-iv',
    name: 'GTA IV',
    formats: 'RPF2 / RPF3',
    detail: 'Manual key or executable scan'
  },
  {
    id: 'gta-v',
    name: 'GTA V',
    formats: 'RPF7',
    detail: 'Keys acquired from game files'
  },
  {
    id: 'rdr1',
    name: 'Red Dead Redemption',
    formats: 'RPF6',
    detail: 'Manual key or executable scan'
  },
  {
    id: 'rdr2',
    name: 'Red Dead Redemption 2',
    formats: 'RPF8',
    detail: 'Keys acquired from game files'
  },
];

const state = {
  summary: null,
  selectedGame: null,
  archive: null,
  archiveIndex: null,
  directory: 0,
  selectedEntry: null,
  preview: null,
  previewOpen: false,
  previewRequestId: 0,
  filter: '',
  globalResults: null,
  globalSearchActive: false,
  globalSkipped: 0,
  busy: false,
  progress: null,
  error: '',
  notice: '',
  mobilePane: 'archives',
};

const app = document.querySelector('#app');
const icon = (mark, label = '') =>
    `<span class="file-mark" aria-hidden="true">${mark}</span>${label}`;
const escapeHtml = (value = '') =>
    String(value).replace(/[&<>"']/g, (char) => ({
                                        '&': '&amp;',
                                        '<': '&lt;',
                                        '>': '&gt;',
                                        '"': '&quot;',
                                        '\'': '&#39;',
                                      }[char]));
const humanSize = (size = 0) => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`;
  return `${(size / 1024 ** 3).toFixed(1)} GB`;
};
const fileType = (name = '') => {
  const ext = name.split('.').pop().toLowerCase();
  if (['png', 'jpg', 'jpeg', 'dds'].includes(ext)) return 'IMAGE';
  if ([
        'txt', 'xml', 'json', 'csv', 'ini', 'cfg', 'meta', 'dat', 'ide', 'ipl',
        'lua', 'fx'
      ].includes(ext))
    return 'TEXT';
  if (['ydr', 'ydd', 'yft', 'wdr', 'wft', 'wtd'].includes(ext))
    return 'RESOURCE';
  if (['wav', 'mp3', 'awc', 'ogg', 'bik'].includes(ext)) return 'AUDIO';
  return ext ? ext.toUpperCase() : 'FILE';
};

function render() {
  if (!state.summary?.gameId)
    renderHome();
  else
    renderExplorer();
}

function closePreview() {
  if (!state.previewOpen) return;
  state.previewOpen = false;
  render();
  app.querySelector('[data-open-preview]')?.focus();
}

function renderHome() {
  app.innerHTML = `
    <section class="welcome">
      <header class="welcome-top">
        <div class="brand"><span class="brand-symbol">R</span><span>RPF Explorer</span></div>
        <span class="version-label">DESKTOP TOOL · WINDOWS</span>
      </header>
      <div class="welcome-body">
        <div class="eyebrow"><span class="status-dot"></span> Rockstar archive browser</div>
        <h1>Choose a game<br /><span>to get started.</span></h1>
        <p class="intro">Browse archive contents, inspect supported assets, and extract files locally.</p>
        <div class="game-list" role="list">
          ${
      games
          .map(
              (game) => `
            <button class="game-option ${
                  state.selectedGame === game.id ?
                      'is-selected' :
                      ''}" data-game="${game.id}" role="listitem">
              <span class="game-initial">${
                  game.name.split(' ')
                      .map((word) => word[0])
                      .slice(0, 2)
                      .join('')}</span>
              <span class="game-copy"><strong>${game.name}</strong><small>${
                  game.detail}</small></span>
              <span class="format-tag">${game.formats}</span>
              <span class="row-arrow" aria-hidden="true">↗</span>
            </button>`)
          .join('')}
        </div>
        <div class="setup-area">
          <div class="setup-heading">
            <div><span class="section-label">GAME SETUP</span><h2>${
      state.selectedGame ?
          escapeHtml(
              games.find((game) => game.id === state.selectedGame).name) :
          'Select a game above'}</h2></div>
            <span class="setup-step">${
      state.selectedGame ? 'READY TO OPEN' : 'STEP 01 / 02'}</span>
          </div>
          ${
      state.selectedGame && !['gta-v', 'rdr2'].includes(state.selectedGame) ?
          `
            <label class="key-field">AES key <span>Optional · 64 hexadecimal characters</span>
              <input id="key-input" type="password" spellcheck="false" autocomplete="off" placeholder="Leave blank to search game executables" value="${
              escapeHtml(state.keyInput || '')}" />
            </label>` :
          ''}
          <button class="primary-button" id="choose-folder" ${
      !state.selectedGame || state.busy ? 'disabled' : ''}>
            ${
      state.busy ? '<span class="spinner"></span> Scanning game folder…' :
                   'Choose game folder <span aria-hidden="true">→</span>'}
          </button>
          ${
      state.error ? `<p class="inline-error" role="alert">${
                        escapeHtml(state.error)}</p>` :
                    ''}
          <p class="privacy-note"><span class="lock-icon" aria-hidden="true">⌑</span> Files stay on this device. No network access is required.</p>
        </div>
      </div>
      <footer class="welcome-footer"><span>RPF Explorer</span><span>RPF2 · RPF3 · RPF4 · RPF6 · RPF7 · RPF8</span></footer>
    </section>`;

  app.querySelectorAll('[data-game]')
      .forEach((button) => button.addEventListener('click', () => {
        state.selectedGame = button.dataset.game;
        state.error = '';
        render();
      }));
  app.querySelector('#choose-folder')?.addEventListener('click', chooseFolder);
  app.querySelector('#key-input')?.addEventListener('input', (event) => {
    state.keyInput = event.target.value;
  });
}

async function chooseFolder() {
  state.previewRequestId++;
  state.previewOpen = false;
  state.selectedEntry = null;
  state.preview = null;
  state.busy = true;
  state.error = '';
  render();
  try {
    state.summary = await invoke('choose_game_folder', {
      gameId: state.selectedGame,
      keyInput: state.keyInput || null,
    });
    state.archive = null;
    state.archiveIndex = null;
    state.selectedEntry = null;
    state.preview = null;
    state.previewOpen = false;
    state.filter = '';
    state.globalResults = null;
    state.globalSearchActive = false;
    state.globalSkipped = 0;
    state.mobilePane = 'archives';
    state.notice = state.summary.status;
  } catch (error) {
    state.error = String(error);
  } finally {
    state.busy = false;
    render();
  }
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

  app.innerHTML = `
    <section class="workspace mobile-${state.mobilePane}">
      <header class="toolbar">
        <div class="toolbar-brand"><span class="brand-symbol">R</span><button class="back-button" id="back-games">Games</button><span class="crumb-slash">/</span><strong>${
      escapeHtml(summary.gameName)}</strong></div>
        <div class="toolbar-actions">
          <span class="folder-context" title="${escapeHtml(summary.root)}">${
      escapeHtml(summary.root)}</span>
          <button class="button subtle" id="open-folder">Open folder</button>
        </div>
      </header>
      <div class="commandbar">
        <label class="searchbox"><span aria-hidden="true">⌕</span><input id="filter" type="search" placeholder="Filter this archive…" value="${
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
          <button class="${state.mobilePane === 'archives' ? 'active' : ''}" data-pane="archives">Archives <span>${summary.archives.length}</span></button>
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
          <div class="panel-heading"><div><span class="section-label">LIBRARY</span><h2>Archives</h2></div><span class="count-pill">${
      summary.archives.length}</span></div>
          <div class="archive-list">
            ${
      summary.archives
          .map(
              (item) => `
              <button class="archive-item ${
                  state.archiveIndex === item.index ?
                      'active' :
                      ''}" data-archive="${item.index}">
                <span class="archive-icon">RPF</span><span class="archive-name" title="${
                  escapeHtml(item.path)}">${
                  escapeHtml(item.path.split('/').pop())}<small>${
                  item.loaded ? `${item.entryCount.toLocaleString()} entries` :
                      item.error ? 'Could not open' :
                                   'Not opened'}</small></span>
                <span class="archive-state ${
                  item.error      ? 'bad' :
                      item.loaded ? 'ready' :
                                    ''}">${
                  item.error      ? '!' :
                      item.loaded ? '●' :
                                    ''}</span>
              </button>`)
          .join('')}
          </div>
          <div class="library-status"><span class="status-dot"></span><span>${
      escapeHtml(summary.status)}</span></div>
        </aside>
        <section class="file-panel">
          <div class="file-heading">
            <div><span class="section-label">${
      state.globalSearchActive ? 'GLOBAL SEARCH' :
          archive         ? `${archive.version} ARCHIVE` :
                            'ARCHIVE CONTENTS'}</span>
              <h2>${
      state.globalSearchActive ?
                  `Results${state.filter ? ` for “${escapeHtml(state.filter)}”` : ''}` :
                  archive                ? escapeHtml(current?.name || archive.path.split('/').pop()) :
                                           'Select an archive'}</h2></div>
            ${
      archive && !state.globalSearchActive ?
                                 `<div class="crumbs">${crumbsHtml(archive, state.directory)}</div>` :
                                 ''}
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
    ${state.previewOpen && selected && state.preview ? renderPreviewDialog(selected) : ''}`;

  app.querySelector('#back-games').addEventListener('click', () => {
    state.previewRequestId++;
    state.summary = null;
    state.archive = null;
    state.selectedEntry = null;
    state.preview = null;
    state.previewOpen = false;
    state.error = '';
    state.notice = '';
    render();
  });
  app.querySelector('#open-folder').addEventListener('click', chooseFolder);
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
  app.querySelectorAll('[data-archive]')
      .forEach(
          (button) => button.addEventListener(
              'click', () => openArchive(Number(button.dataset.archive))));
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
        if (!item?.isDir) return;
        event.preventDefault();
        openDirectory(item);
      }));
  app.querySelectorAll('[data-result]')
      .forEach(
          (button) => button.addEventListener(
              'click', () => selectResult(Number(button.dataset.result))));
  app.querySelector('#extract-entry')?.addEventListener('click', extractEntry);
  app.querySelector('#extract-folder')
      ?.addEventListener('click', extractFolder);
  app.querySelector('[data-open-preview]')?.addEventListener('click', () => {
    state.previewOpen = true;
    render();
    app.querySelector('#preview-dialog-close')?.focus();
  });
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
  if (state.previewOpen && previewDialog && !previewDialog.open)
    previewDialog.showModal();
}

function renderFileTable(entries) {
  if (!entries.length)
    return renderEmpty(
        'No matching files',
        state.filter ? 'Try a different name or search all archives.' :
                       'This folder is empty.');
  return `<div class="table-wrap"><table class="file-table"><thead><tr><th>NAME</th><th>TYPE</th><th>SIZE</th></tr></thead><tbody>${
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
                      entry.isDir ? 'DIR' : markFor(entry.name),
                      escapeHtml(entry.name))}</button></td>
      <td><span class="type-label">${
                  entry.isDir ? 'FOLDER' : fileType(entry.name)}</span></td>
      <td class="size-cell">${entry.isDir ? '—' : humanSize(entry.size)}</td>
    </tr>`)
          .join('')}</tbody></table></div>`;
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
  const preview = state.preview;
  const image = preview?.kind === 'image';
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
      icon(entry.isDir ? 'DIR' : markFor(entry.name))}<div><h3 title="${
      escapeHtml(entry.name)}">${escapeHtml(entry.name)}</h3><span>${
      entry.isDir ? 'Folder' : fileType(entry.name)}</span></div></div>
    ${details}
    <div class="preview-section"><div class="preview-heading"><span class="section-label">PREVIEW</span>${
      state.preview?.kind === 'text' ?
          '<span class="preview-note-label">TEXT</span>' :
          ''}${preview ? `<button class="button subtle small preview-open-button" data-open-preview aria-haspopup="dialog" aria-label="Open full preview of ${escapeHtml(entry.name)}">Expand</button>` : ''}</div>
      <div class="preview-content">${
      preview ?
          renderPreview(preview) :
          entry.isDir ?
          '<div class="preview-empty">Folder selected</div>' :
          '<div class="preview-empty"><span class="loading-ring"></span><span>Preparing preview…</span></div>'}</div>
    </div>
  </div>`;
}

function renderPreviewDialog(entry) {
  return `<dialog class="preview-dialog" id="preview-dialog" aria-modal="true" aria-labelledby="preview-dialog-title" aria-describedby="preview-dialog-path">
    <div class="preview-dialog-panel">
      <header class="preview-dialog-header">
        <div class="preview-dialog-title">
          <span class="section-label">ASSET PREVIEW</span>
          <h2 id="preview-dialog-title">${escapeHtml(entry.name)}</h2>
          <p id="preview-dialog-path" title="${escapeHtml(entry.path)}">${escapeHtml(entry.path)}</p>
        </div>
        <button class="button subtle preview-dialog-close" id="preview-dialog-close" aria-label="Close preview" autofocus>Close <span aria-hidden="true">×</span></button>
      </header>
      <div class="preview-dialog-content">${renderPreview(state.preview)}</div>
      <footer class="preview-dialog-footer"><span>${fileType(entry.name)} · ${humanSize(entry.size)}</span><span>ESC TO CLOSE</span></footer>
    </div>
  </dialog>`;
}

function renderPreview(preview) {
  if (preview.kind === 'image')
    return `<div class="image-preview"><img src="${
        preview.content}" alt="Preview of ${
        escapeHtml(preview.name)}" /></div>`;
  if (preview.kind === 'text')
    return `<pre class="text-preview">${escapeHtml(preview.content)}</pre>`;
  return `<div class="unsupported-preview"><span class="preview-mark">PREVIEW</span><p>${
      escapeHtml(preview.content)}</p></div>`;
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
  if (['png', 'jpg', 'jpeg', 'dds'].includes(ext)) return 'IMG';
  if ([
        'txt', 'xml', 'json', 'csv', 'ini', 'cfg', 'meta', 'dat', 'ide', 'ipl'
      ].includes(ext))
    return 'TXT';
  if (['ydr', 'ydd', 'yft', 'wdr', 'wft', 'wtd'].includes(ext)) return '3D';
  if (['wav', 'mp3', 'awc', 'ogg', 'bik'].includes(ext)) return 'AUD';
  return 'FILE';
}

async function openArchive(index) {
  state.previewRequestId++;
  state.previewOpen = false;
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

async function selectEntry(index) {
  const requestId = ++state.previewRequestId;
  const archiveIndex = state.archiveIndex;
  state.selectedEntry = index;
  state.mobilePane = 'inspector';
  state.preview = null;
  state.previewOpen = false;
  render();
  try {
    const preview =
        await invoke('preview_entry', {archiveIndex, entryIndex: index});
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
    .then((summary) => {
      state.summary = summary.gameId ? summary : null;
      render();
    })
    .catch(() => render());
