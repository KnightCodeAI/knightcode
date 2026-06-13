// TODO: the auto-memory feature isn't ported. This inert check lets the Read
// tool treat no path as an auto-memory file until it lands.

export function isAutoMemFile(_filePath: string): boolean {
  return false
}
