import {escapeHtml, fileType, humanSize} from '../utils.js';
import {icon} from './icons.js';
import {markFor, renderEmpty} from './markup.js';

export function renderFileTable(entries, state) {
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

export function renderGameDirectory(path, depth, summary, state) {
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
      return `<div class="game-tree-node"><button class="game-tree-item is-folder" role="treeitem" aria-level="${depth + 1}" aria-expanded="${expanded}" data-game-dir="${escapeHtml(entry.path)}" style="padding-left:${padding}px"><span class="game-tree-toggle" aria-hidden="true">${expanded ? '⌄' : '›'}</span>${icon('folder')}<span class="game-tree-name" title="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</span></button>${expanded ? `<div class="game-tree-children" role="group">${renderGameDirectory(entry.path, depth + 1, summary, state)}</div>` : ''}</div>`;
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

export function renderGlobalResults(state) {
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

export function renderInspector(entry, archive) {
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
