export function createExtractionActions({state, invoke, render}) {
  async function extractEntry() {
    try {
      state.notice = await invoke(
          'extract_file',
          {archiveIndex: state.archiveIndex, entryIndex: state.selectedEntry});
      state.error = '';
    } catch (error) {
      state.error = String(error);
    }
    render();
  }

  async function extractFolder() {
    try {
      state.notice = await invoke(
          'extract_folder',
          {archiveIndex: state.archiveIndex, entryIndex: state.selectedEntry});
      state.error = '';
    } catch (error) {
      state.error = String(error);
    }
    render();
  }

  return {extractEntry, extractFolder};
}
