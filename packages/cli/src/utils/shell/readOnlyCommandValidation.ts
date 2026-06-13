// TODO: the full read-only shell-command validator (command classification,
// argument safety) lands with the shell tool's security layer. Only the UNC
// path check the permission layer needs lives here for now.

import { getPlatform } from '../platform.js'

export function containsVulnerableUncPath(pathOrCommand: string): boolean {
  // Only check on Windows platform
  if (getPlatform() !== 'windows') {
    return false
  }

  // 1. Check for general UNC paths with backslashes
  // Pattern matches: \\server, \\server\share, \\server/share, \\server@port\share
  // Uses [^\s\\/]+ for hostname to catch Unicode homoglyphs and other non-ASCII chars
  // Trailing accepts both \ and / since Windows treats both as path separators
  const backslashUncPattern = /\\\\[^\s\\/]+(?:@(?:\d+|ssl))?(?:[\\/]|$|\s)/i
  if (backslashUncPattern.test(pathOrCommand)) {
    return true
  }

  // 2. Check for forward-slash UNC paths
  // Pattern matches: //server, //server/share, //server\share, //192.168.1.1/share
  // Uses negative lookbehind (?<!:) to exclude URLs (https://, http://, ftp://)
  // while catching // preceded by quotes, =, or any other non-colon character.
  // Trailing accepts both / and \ since Windows treats both as path separators
  const forwardSlashUncPattern =
    // eslint-disable-next-line custom-rules/no-lookbehind-regex -- .test() on short command strings
    /(?<!:)\/\/[^\s\\/]+(?:@(?:\d+|ssl))?(?:[\\/]|$|\s)/i
  if (forwardSlashUncPattern.test(pathOrCommand)) {
    return true
  }

  // 3. Check for mixed-separator UNC paths (forward slash + backslashes)
  // On Windows/Cygwin, /\ is equivalent to // since both are path separators.
  // In bash, /\\server becomes /\server after escape processing, which is a UNC path.
  // Requires 2+ backslashes after / because a single backslash just escapes the next char
  // (e.g., /\a → /a after bash processing, which is NOT a UNC path).
  const mixedSlashUncPattern = /\/\\{2,}[^\s\\/]/
  if (mixedSlashUncPattern.test(pathOrCommand)) {
    return true
  }

  // 4. Check for mixed-separator UNC paths (backslashes + forward slash)
  // \\/server in bash becomes \/server after escape processing, which is a UNC path
  // on Windows since both \ and / are path separators.
  const reverseMixedSlashUncPattern = /\\{2,}\/[^\s\\/]/
  if (reverseMixedSlashUncPattern.test(pathOrCommand)) {
    return true
  }

  // 5. Check for WebDAV SSL/port patterns
  // Examples: \\server@SSL@8443\path, \\server@8443@SSL\path
  if (/@SSL@\d+/i.test(pathOrCommand) || /@\d+@SSL/i.test(pathOrCommand)) {
    return true
  }

  // 6. Check for DavWWWRoot marker (Windows WebDAV redirector)
  // Example: \\server\DavWWWRoot\path
  if (/DavWWWRoot/i.test(pathOrCommand)) {
    return true
  }

  // 7. Check for UNC paths with IPv4 addresses (explicit check for defense-in-depth)
  // Examples: \\192.168.1.1\share, \\10.0.0.1\path
  if (
    /^\\\\(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})[\\/]/.test(pathOrCommand) ||
    /^\/\/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})[\\/]/.test(pathOrCommand)
  ) {
    return true
  }

  // 8. Check for UNC paths with bracketed IPv6 addresses (explicit check for defense-in-depth)
  // Examples: \\[2001:db8::1]\share, \\[::1]\path
  if (
    /^\\\\(\[[\da-fA-F:]+\])[\\/]/.test(pathOrCommand) ||
    /^\/\/(\[[\da-fA-F:]+\])[\\/]/.test(pathOrCommand)
  ) {
    return true
  }

  return false
}
