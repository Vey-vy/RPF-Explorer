import {listen} from '@tauri-apps/api/event';

export function listenForGameLoadProgress({state, app}) {
  return listen('game-load-progress', (event) => {
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
}

export function listenForArchiveProgress({state, app}) {
  return listen('index-progress', (event) => {
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
}
