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

export const icon = (type, label = '') => {
  const shape = drawings[type] || drawings.file;
  return `<svg class="file-mark file-mark-${type}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shape}</svg>${label}`;
};
