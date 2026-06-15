// TODO: the in-process Claude-in-Chrome MCP server is not ported. Inert: only
// reached for a "claude-in-chrome" server, which is never matched here.

export function createChromeContext(_env: Record<string, string> | undefined): {
  env: Record<string, string> | undefined
} {
  return { env: _env }
}
