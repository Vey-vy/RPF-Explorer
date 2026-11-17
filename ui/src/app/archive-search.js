export function createArchiveSearchActions({
  state,
  invoke,
  render,
  openArchive,
  selectEntry,
}) {
  async function searchAll() {
    state.globalResults = null;
    state.globalSearchActive = true;
    state.globalSkipped = 0;
    state.mobilePane = 'files';
    state.progress = {
      completed: 0,
      total: state.summary.archives.length,
      matches: 0,
      failed: 0
    };
    state.busy = true;
    state.error = '';
    render();
    try {
      const response = await invoke('index_archives', {query: state.filter});
      state.globalResults = response.results;
      state.globalSkipped = response.skippedArchives;
      state.notice = `${state.globalResults.length.toLocaleString()} result${
          state.globalResults.length === 1 ? '' : 's'}${
          state.globalResults.length === 1000 ? ' · 1,000 result limit reached' :
                                                ''}${
          response.skippedArchives ?
              ` · ${response.skippedArchives} archive(s) could not be opened` :
              ''}`;
    } catch (error) {
      state.error = String(error);
    } finally {
      state.busy = false;
      state.progress = null;
      render();
    }
  }

  async function selectResult(index) {
    const result = state.globalResults[index];
    if (!result) return;
    await openArchive(result.archiveIndex);
    const item =
        state.archive?.entries.find((entry) => entry.index === result.entryIndex);
    state.directory = item?.isDir ? item.index : (item?.parent ?? 0);
    state.globalSearchActive = false;
    state.globalResults = null;
    state.mobilePane = 'inspector';
    await selectEntry(result.entryIndex);
  }

  return {searchAll, selectResult};
}
