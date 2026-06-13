// TODO: macOS keychain credential storage is not wired up. Report unlocked so
// the assistant message never shows the keychain-locked notice.
export function isMacOsKeychainLocked(): boolean {
  return false
}
