// TODO: team-memory paths land with the teammate-memory subsystem. Team memory
// is not part of this build, so every path check reports "not team memory".

export function isTeamMemoryEnabled(): boolean {
  return false
}

export function isTeamMemPath(_filePath: string): boolean {
  return false
}

export function isTeamMemFile(_filePath: string): boolean {
  return false
}
