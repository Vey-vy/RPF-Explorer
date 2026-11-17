import {renderModelPreview} from '../model-viewer.js';
import {highlightText} from '../syntax-highlight.js';
import {escapeHtml, fileType, humanSize} from '../utils.js';

export function renderPreviewDialog(entry, preview = null) {
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
  if (preview.kind === 'texture-dictionary')
    return renderTextureDictionaryPreview(preview);
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

function renderTextureDictionaryPreview(preview) {
  const content = JSON.parse(preview.content);
  const textures = content.textures || [];
  if (!textures.length) {
    return `<div class="unsupported-preview"><span class="preview-mark">YTD</span><p>No textures could be previewed.${
        content.omittedTextures ? ` ${content.omittedTextures} skipped.` : ''}</p>${
        (content.warnings || [])
            .map((warning) => `<p>${escapeHtml(warning)}</p>`)
            .join('')}</div>`;
  }
  const first = textures[0];
  const metadata = (texture) =>
      `${texture.width} × ${texture.height} · ${escapeHtml(texture.format)} · ${
          texture.levels} mip${texture.levels === 1 ? '' : 's'}`;
  const notices = [
    content.omittedTextures ?
        `${content.omittedTextures} texture(s) omitted by preview limits.` :
        '',
    ...(content.warnings || []),
  ].filter(Boolean);

  return `<section class="texture-dictionary-preview" aria-label="YTD texture dictionary">
    <header class="texture-dictionary-toolbar"><strong>TEXTURE DICTIONARY</strong><span>${
      content.totalTextures} textures · YTD</span></header>
    <div class="texture-dictionary-workspace">
      <div class="texture-dictionary-selected">
        <div class="texture-dictionary-image"><img data-ytd-main-image src="data:image/png;base64,${
      first.imageData}" alt="Preview of ${escapeHtml(first.name)}"></div>
        <div class="texture-dictionary-details"><strong data-ytd-main-name>${
      escapeHtml(first.name)}</strong><span data-ytd-main-meta>${
      metadata(first)}</span></div>
      </div>
      <div class="texture-dictionary-grid" aria-label="Textures">
        ${textures.map((texture, index) => {
          const meta = metadata(texture);
          return `<button class="texture-dictionary-item${
              index === 0 ? ' selected' : ''}" type="button" data-ytd-texture-index="${
              index}" data-texture-name="${escapeHtml(texture.name)}" data-texture-meta="${
              meta}" aria-pressed="${index === 0}" aria-label="Show texture ${
              escapeHtml(texture.name)}">
            <span class="texture-dictionary-thumb"><img src="data:image/png;base64,${
              texture.imageData}" alt="" loading="lazy"></span>
            <strong>${escapeHtml(texture.name)}</strong><small>${meta}</small>
          </button>`;
        }).join('')}
      </div>
    </div>
    ${notices.length ? `<footer class="texture-dictionary-notices">${
      notices.map((notice) => `<span>${escapeHtml(notice)}</span>`).join('')}</footer>` : ''}
  </section>`;
}
