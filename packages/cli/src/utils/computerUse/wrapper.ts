// TODO: the computer-use MCP server (gated off; native host packages) is not
// ported, so its per-tool display overrides are never needed. Inert: no
// overrides.

export function getComputerUseMCPToolOverrides(
  _toolName: string,
): Record<string, unknown> {
  return {}
}
