// TODO: the Claude-in-Chrome browser-extension MCP server is not ported, so its
// per-tool display overrides are never needed. Inert: no overrides.

export function getClaudeInChromeMCPToolOverrides(
  _toolName: string,
): Record<string, unknown> {
  return {}
}
