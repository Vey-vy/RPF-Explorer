import {bindExplorerEvents} from './explorer-events.js';
import {bindPreviewEvents} from './preview-events.js';

export function renderExplorerView({
  app,
  state,
  escapeHtml,
  fileType,
  crumbsHtml,
  renderEmpty,
  renderFileTable,
  renderGameDirectory,
  renderGlobalResults,
  renderInspector,
  renderPreviewDialog,
  render,
  actions,
  isNativeModelPayload,
  mountModelViewer,
  mountNativeModelViewer,
  setModelViewerDisposer,
}) {
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
            ${renderGameDirectory('', 0, summary, state)}
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
                                 renderGlobalResults(state) :
                                 archive ?
                                 renderFileTable(filtered, state) :
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

  bindExplorerEvents({app, state, archive, parentDirectory, render, actions});
  bindPreviewEvents({
    app,
    state,
    actions,
    isNativeModelPayload,
    mountModelViewer,
    mountNativeModelViewer,
    setModelViewerDisposer,
  });
}
