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

// Whether the CLI is running inside a supported JetBrains IDE terminal. IDE
// integration is not wired, so this never matches.
export function isSupportedJetBrainsTerminal(): boolean {
  return false
}

// The IDE type hosting the terminal, if recognized. No IDE detection yet.
export function getTerminalIdeType(): IdeType | null {
  return null
}

// TODO: IDE integration is out of scope for a terminal BYOK build.
export function isJetBrainsIde(..._args: any[]): boolean { return false }
export function getIdeClientName(..._args: any[]): string | undefined { return undefined }
export function isSupportedTerminal(..._args: any[]): boolean { return false }
export function hasAccessToIDEExtensionDiffFeature(..._args: any[]): boolean { return false }

// TODO: IDE client lookup / diff closing land with IDE integration; inert.
export function getConnectedIdeClient(
  ..._args: unknown[]
): import('../services/mcp/types.js').ConnectedMCPServer | undefined {
  return undefined
}
export async function closeOpenDiffs(..._args: unknown[]): Promise<void> {}

// TODO: IDE connection notifications land with IDE integration; inert (no IDE
// is ever connected in a terminal BYOK build).
export async function maybeNotifyIDEConnected(
  _client: import('@modelcontextprotocol/sdk/client/index.js').Client,
): Promise<void> {}
