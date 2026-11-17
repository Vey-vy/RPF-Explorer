import {escapeHtml} from '../utils.js';

export function renderHome({app, games, state, onChooseFolder}) {
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
    button.addEventListener('click', () => onChooseFolder(button.dataset.game)));
}
