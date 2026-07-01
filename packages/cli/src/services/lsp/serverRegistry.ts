// LSP server registry: maps file extensions to language servers, resolves the
// project root for a file, and locates each server's binary on PATH.
//
// Servers spawn lazily (see manager.ts), so this module only describes how to
// find and launch each server — it does not start any process itself.

import { existsSync } from 'fs'
import { dirname, extname, join, parse } from 'path'
import { whichSync } from '../../utils/which.js'

/** A language server definition. */
export interface LSPServerDef {
  /** Stable identifier, also used as the diagnostic "serverName". */
  id: string
  /** Lowercased file extensions (with leading dot) this server handles. */
  extensions: string[]
  /** Executable name resolved against PATH (Windows PATHEXT-aware). */
  command: string
  /** Arguments passed when spawning the server over stdio. */
  args: string[]
  /**
   * Marker files whose nearest ancestor directory is the workspace root for a
   * given file. Falls back to the session cwd when none is found.
   */
  rootMarkers: string[]
  /**
   * Optional `initializationOptions` for the LSP `initialize` request, computed
   * from the resolved workspace root. Also replayed via
   * workspace/didChangeConfiguration and answered to workspace/configuration.
   */
  initialization?: (root: string) => Record<string, unknown> | undefined
}

/**
 * Locates the workspace's own `typescript/lib/tsserver.js` by walking up from
 * the project root. typescript-language-server works without this, but pointing
 * it at the project's TypeScript version keeps diagnostics consistent with the
 * checker the project actually uses.
 */
function resolveTsserverPath(root: string): string | undefined {
  let dir = root
  const { root: fsRoot } = parse(dir)
  for (let i = 0; i < 100; i++) {
    const candidate = join(dir, 'node_modules', 'typescript', 'lib', 'tsserver.js')
    if (existsSync(candidate)) return candidate
    if (dir === fsRoot) break
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

/**
 * The built-in servers. Extension lists mirror the conventions used by the
 * reference opencode implementation. A server only participates if its binary
 * is actually installed (see findServerBinary), so listing one here is free
 * when the user doesn't have it.
 */
export const LSP_SERVERS: readonly LSPServerDef[] = [
  {
    id: 'typescript',
    extensions: [
      '.ts',
      '.tsx',
      '.mts',
      '.cts',
      '.js',
      '.jsx',
      '.mjs',
      '.cjs',
    ],
    command: 'typescript-language-server',
    args: ['--stdio'],
    rootMarkers: ['tsconfig.json', 'jsconfig.json', 'package.json'],
    initialization: root => {
      const tsserver = resolveTsserverPath(root)
      return tsserver ? { tsserver: { path: tsserver } } : undefined
    },
  },
  {
    id: 'pyright',
    extensions: ['.py', '.pyi'],
    command: 'pyright-langserver',
    args: ['--stdio'],
    rootMarkers: [
      'pyproject.toml',
      'setup.py',
      'setup.cfg',
      'requirements.txt',
      'Pipfile',
    ],
  },
  {
    id: 'gopls',
    extensions: ['.go'],
    command: 'gopls',
    args: [],
    rootMarkers: ['go.work', 'go.mod'],
  },
  {
    id: 'rust-analyzer',
    extensions: ['.rs'],
    command: 'rust-analyzer',
    args: [],
    rootMarkers: ['Cargo.toml', 'Cargo.lock'],
  },
]

/** Returns the first server that handles the given file, or undefined. */
export function resolveServerForFile(
  filePath: string,
): LSPServerDef | undefined {
  return resolveServersForFile(filePath)[0]
}

/**
 * Returns every server that handles the given file (a file may be served by
 * more than one server, e.g. a type checker plus a linter). Order follows
 * LSP_SERVERS.
 */
export function resolveServersForFile(filePath: string): LSPServerDef[] {
  const ext = extname(filePath).toLowerCase()
  if (!ext) return []
  return LSP_SERVERS.filter(server => server.extensions.includes(ext))
}

/**
 * Walks up from the file's directory looking for one of the server's root
 * markers, stopping at the filesystem root. Returns the nearest matching
 * directory, or `fallbackCwd` when no marker is found.
 */
export function resolveProjectRoot(
  filePath: string,
  server: LSPServerDef,
  fallbackCwd: string,
): string {
  let dir = dirname(filePath)
  const { root } = parse(dir)
  // Guard against symlink loops / pathological depth.
  for (let i = 0; i < 100; i++) {
    for (const marker of server.rootMarkers) {
      if (existsSync(join(dir, marker))) {
        return dir
      }
    }
    if (dir === root) break
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return fallbackCwd
}

// Binary resolution is cached: PATH does not change within a session and
// scanning it (with Windows PATHEXT expansion) for every isEnabled() call is
// wasteful. Maps server id -> resolved absolute path (or null if not found).
const binaryCache = new Map<string, string | null>()

/** Resolves the server's executable on PATH, or null if not installed. */
export function findServerBinary(server: LSPServerDef): string | null {
  const cached = binaryCache.get(server.id)
  if (cached !== undefined) return cached
  const resolved = whichSync(server.command) ?? null
  binaryCache.set(server.id, resolved)
  return resolved
}

/** Server ids whose binaries are currently installed. */
export function getAvailableServerIds(): string[] {
  return LSP_SERVERS.filter(s => findServerBinary(s) !== null).map(s => s.id)
}

/** Test seam: clears the binary-resolution cache. */
export function clearBinaryCache(): void {
  binaryCache.clear()
}
