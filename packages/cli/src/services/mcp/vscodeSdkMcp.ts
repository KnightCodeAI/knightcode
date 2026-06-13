// TODO: the VS Code companion MCP integration lands with the IDE layer. The
// file tools notify it after a write so the editor can refresh; with no VS Code
// session attached this is inert.

export function notifyVscodeFileUpdated(
  _filePath: string,
  _oldContent: string | null,
  _newContent: string | null,
): void {}
