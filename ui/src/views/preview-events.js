export function bindPreviewEvents({
  app,
  state,
  actions,
  isNativeModelPayload,
  mountModelViewer,
  mountNativeModelViewer,
  setModelViewerDisposer,
}) {
  const {closePreview, selectModelDrawable} = actions;
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
  previewDialog?.querySelectorAll('[data-ytd-texture-index]')
      .forEach((button) => button.addEventListener('click', () => {
        const thumbnail = button.querySelector('img');
        const image = previewDialog.querySelector('[data-ytd-main-image]');
        if (!thumbnail || !image) return;
        image.src = thumbnail.src;
        image.alt = `Preview of ${button.dataset.textureName}`;
        previewDialog.querySelector('[data-ytd-main-name]').textContent =
            button.dataset.textureName;
        previewDialog.querySelector('[data-ytd-main-meta]').textContent =
            button.dataset.textureMeta;
        previewDialog.querySelectorAll('[data-ytd-texture-index]')
            .forEach((item) => {
              const selected = item === button;
              item.classList.toggle('selected', selected);
              item.setAttribute('aria-pressed', String(selected));
            });
      }));

  if (state.previewOpen && previewDialog && !previewDialog.open)
    previewDialog.showModal();
  const preview = state.selectedGameFile ? state.gameFilePreview : state.preview;
  if (state.previewOpen && preview?.kind === 'model' &&
      !isNativeModelPayload(preview))
    setModelViewerDisposer(mountModelViewer(previewDialog, preview));
  else if (state.previewOpen && preview?.kind === 'model')
    mountNativeModelViewer(previewDialog, preview);
}
