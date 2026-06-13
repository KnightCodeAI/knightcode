// TODO: LSP integration lands with the tool layer. The file tools notify the
// manager of file changes/saves so language servers stay in sync; with no LSP
// running there is no manager to return.

export function getInitializationStatus(): { status: string } {
  return { status: 'not-started' }
}

export type LSPServerManager = {
  changeFile(filePath: string, content: string): Promise<void>
  saveFile(filePath: string): Promise<void>
}

export function getLspServerManager(): LSPServerManager | undefined {
  return undefined
}
