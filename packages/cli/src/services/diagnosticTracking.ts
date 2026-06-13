// TODO: LSP diagnostic tracking (capturing diagnostics before/after an edit to
// surface new problems) lands with the LSP layer. Until then the tracker is
// inert and reports no diagnostics.

export const diagnosticTracker = {
  async beforeFileEdited(_filePath: string): Promise<void> {},
}
