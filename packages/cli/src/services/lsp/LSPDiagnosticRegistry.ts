// TODO: the LSP diagnostic registry lands with the LSP layer. The file tools
// clear delivered diagnostics for a file after writing it; with no LSP running
// this is inert.

export function clearDeliveredDiagnosticsForFile(_filePath: string): void {}
