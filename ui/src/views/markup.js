import {escapeHtml} from '../utils.js';

export function renderEmpty(title, description) {
  return `<div class="empty-state"><span class="empty-glyph" aria-hidden="true">R</span><h3>${
      title}</h3><p>${description}</p></div>`;
}

export function crumbsHtml(archive, directory) {
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

export function markFor(name = '') {
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
