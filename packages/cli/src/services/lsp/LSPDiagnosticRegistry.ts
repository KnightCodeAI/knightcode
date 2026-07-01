// Stores LSP diagnostics pushed by servers (textDocument/publishDiagnostics)
// until the agent loop delivers them as attachments. The file tools clear a
// file's entry right after editing it (so stale problems are not re-surfaced),
// and the delivery path clears everything once consumed.
//
// Keys are normalized absolute paths, because the producer (server URIs like
// file:///c%3A/foo) and the consumer (file tools passing `file://${path}`) use
// different URI spellings for the same file.

import type { DiagnosticFile } from '../diagnosticTracking.js'

interface Entry {
  serverName: string
  /** Original server URI, preserved for display. */
  uri: string
  diagnostics: unknown[]
}

const entriesByPath = new Map<string, Entry>()

/**
 * Normalizes a file:// URI or raw path to a canonical key. Decodes percent
 * encoding, unifies slashes, and lowercases the Windows drive letter so the
 * server's spelling and the file tools' spelling collide on the same key.
 */
function normalizeKey(uriOrPath: string): string {
  let p = uriOrPath
  if (p.startsWith('file://')) {
    p = p.slice('file://'.length)
    try {
      p = decodeURIComponent(p)
    } catch {
      // leave undecoded if malformed
    }
    // file:///C:/foo -> /C:/foo -> C:/foo
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1)
  }
  p = p.replace(/\\/g, '/')
  // charAt (not p[0]) keeps the type a string under noUncheckedIndexedAccess.
  if (/^[A-Za-z]:/.test(p)) p = p.charAt(0).toLowerCase() + p.slice(1)
  return p
}

/** Called by LSPClient when a server publishes diagnostics for a file. */
export function recordDiagnostics(
  serverName: string,
  uri: string,
  diagnostics: unknown[],
): void {
  const key = normalizeKey(uri)
  if (!diagnostics || diagnostics.length === 0) {
    // Empty array means "this file is now clean" — drop any pending entry.
    entriesByPath.delete(key)
    return
  }
  entriesByPath.set(key, { serverName, uri, diagnostics })
}

/** Drops pending diagnostics for a single file (by URI or path). */
export function clearDeliveredDiagnosticsForFile(filePath: string): void {
  entriesByPath.delete(normalizeKey(filePath))
}

/**
 * Returns pending diagnostics grouped by server. Does not clear them; the
 * caller clears after delivery via clearAllLSPDiagnostics().
 */
export function checkForLSPDiagnostics(): Array<{
  serverName: string
  files: DiagnosticFile[]
}> {
  const byServer = new Map<string, DiagnosticFile[]>()
  for (const entry of entriesByPath.values()) {
    const files = byServer.get(entry.serverName) ?? []
    files.push({ uri: entry.uri, diagnostics: entry.diagnostics })
    byServer.set(entry.serverName, files)
  }
  return [...byServer.entries()].map(([serverName, files]) => ({
    serverName,
    files,
  }))
}

/** Clears all pending diagnostics (after they have been delivered). */
export function clearAllLSPDiagnostics(): void {
  entriesByPath.clear()
}

/** Full reset of diagnostic state (used by /clear). */
export function resetAllLSPDiagnosticState(): void {
  entriesByPath.clear()
}
