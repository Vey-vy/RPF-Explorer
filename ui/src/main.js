import './styles/index.css';

import {invoke, isTauri} from '@tauri-apps/api/core';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {
  isNativeModelPayload,
  mountModelViewer,
  mountNativeModelViewer,
} from './model-viewer.js';
import {escapeHtml, fileType} from './utils.js';
import {games, windowSizes} from './app/games.js';
import {state} from './app/state.js';
import {createArchiveNavigationActions} from './app/archive-navigation.js';
import {createArchiveSearchActions} from './app/archive-search.js';
import {createExtractionActions} from './app/extraction.js';
import {createFilePreviewActions} from './app/file-previews.js';
import {createGameLibraryActions} from './app/game-library.js';
import {listenForArchiveProgress, listenForGameLoadProgress} from './app/progress.js';
import {loadInitialApplication} from './app/startup.js';
import {renderHome as renderHomeView} from './views/home.js';
import {crumbsHtml, renderEmpty} from './views/markup.js';
import {
  renderFileTable,
  renderGameDirectory,
  renderGlobalResults,
  renderInspector,
} from './views/explorer-content.js';
import {renderExplorerView} from './views/explorer.js';
import {renderPreviewDialog} from './views/preview.js';

const app = document.querySelector('#app');
let disposeModelViewer = null;
const gameLoadProgressReady = listenForGameLoadProgress({state, app});
listenForArchiveProgress({state, app});

function render() {
  disposeModelViewer?.();
  disposeModelViewer = null;
  if (!state.summary?.gameId)
    renderHome();
  else
    renderExplorer();
}

async function resizeWindow(size) {
  if (!isTauri()) return;
  try {
    await getCurrentWindow().setSize(size);
  } catch (error) {
    console.error('Unable to resize the application window:', error);
  }
}

const gameLibraryActions = createGameLibraryActions({
  state,
  invoke,
  render,
  resizeWindow,
  windowSizes,
  gameLoadProgressReady,
});
const archiveNavigationActions =
    createArchiveNavigationActions({state, invoke, render});
const filePreviewActions = createFilePreviewActions({
  state,
  app,
  invoke,
  render,
  openNestedArchive: archiveNavigationActions.openNestedArchive,
});
const archiveSearchActions = createArchiveSearchActions({
  state,
  invoke,
  render,
  openArchive: archiveNavigationActions.openArchive,
  selectEntry: filePreviewActions.selectEntry,
});
const extractionActions = createExtractionActions({state, invoke, render});
const actions = {
  ...gameLibraryActions,
  ...archiveNavigationActions,
  ...filePreviewActions,
  ...archiveSearchActions,
  ...extractionActions,
};

function renderHome() {
  renderHomeView({app, games, state, onChooseFolder: actions.chooseFolder});
}

function renderExplorer() {
  renderExplorerView({
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
    setModelViewerDisposer: (disposer) => {
      disposeModelViewer = disposer;
    },
  });
}

loadInitialApplication({
  invoke,
  state,
  windowSizes,
  resizeWindow,
  render,
  loadGameDirectory: gameLibraryActions.loadGameDirectory,
});
