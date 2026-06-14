// TODO: IDE integration (extension install/detection, connected-IDE naming,
// editor selection bridging) is not implemented yet. The attachment and command
// layers reference the IDE shapes and the connected-name lookup; the real types
// live here, and the lookup reports no connected IDE until the integration lands.
import type { MCPServerConnection } from '../services/mcp/types.js'

export type IdeType =
  | 'cursor'
  | 'windsurf'
  | 'vscode'
  | 'pycharm'
  | 'intellij'
  | 'webstorm'
  | 'phpstorm'
  | 'rubymine'
  | 'clion'
  | 'goland'
  | 'rider'
  | 'datagrip'
  | 'appcode'
  | 'dataspell'
  | 'aqua'
  | 'gateway'
  | 'fleet'
  | 'androidstudio'

export interface IDEExtensionInstallationStatus {
  installed: boolean
  error: string | null
  installedVersion: string | null
  ideType: IdeType | null
}

export function getConnectedIdeName(
  _mcpClients: MCPServerConnection[],
): string | null {
  return null
}

const ideDisplayNames: Partial<Record<IdeType, string>> = {
  vscode: 'VS Code',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
}

export function toIDEDisplayName(terminal: string | null): string {
  if (!terminal) return 'IDE'
  return ideDisplayNames[terminal as IdeType] ?? terminal
}
