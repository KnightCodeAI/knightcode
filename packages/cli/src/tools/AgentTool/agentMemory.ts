// TODO: subagent memory directories aren't ported. This inert check lets the
// permission layer treat no path as an agent-memory path until they land.

export function isAgentMemoryPath(_absolutePath: string): boolean {
  return false
}
