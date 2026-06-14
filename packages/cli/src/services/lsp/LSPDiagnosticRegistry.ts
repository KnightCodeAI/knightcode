// TODO: the LSP diagnostic registry lands with the LSP layer. The file tools
// clear delivered diagnostics for a file after writing it; with no LSP running
// this is inert.

import type { DiagnosticFile } from '../diagnosticTracking.js'

export function clearDeliveredDiagnosticsForFile(_filePath: string): void {}

export function checkForLSPDiagnostics(): Array<{
  serverName: string
  files: DiagnosticFile[]
}> {
  return []
}

export function clearAllLSPDiagnostics(): void {}

export function resetAllLSPDiagnosticState(): void {}
