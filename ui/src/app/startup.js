export function loadInitialApplication({
  invoke,
  state,
  windowSizes,
  resizeWindow,
  render,
  loadGameDirectory,
}) {
  invoke('get_summary')
      .then(async (summary) => {
        state.summary = summary.gameId ? summary : null;
        void resizeWindow(
            summary.gameId ? windowSizes.explorer : windowSizes.menu);
        if (state.summary) {
          state.gameTreeGeneration++;
          state.gameTree =
              new Map([['', {loading: true, entries: null, error: ''}]]);
          state.expandedGameDirectories = new Set(['']);
        }
        render();
        if (state.summary) await loadGameDirectory('');
      })
      .catch((error) => {
        state.error = String(error).replace(/^Error:\s*/, '');
        render();
      });
}
