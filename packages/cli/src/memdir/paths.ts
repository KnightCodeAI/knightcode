// TODO: the auto-memory directory feature isn't ported. These inert checks let
// the permission layer treat no path as an auto-memory path until it lands.

export function hasAutoMemPathOverride(): boolean {
  return false
}

export function isAutoMemPath(_absolutePath: string): boolean {
  return false
}
