// TODO: the full which/which-async helpers land with the shell layer. This is
// the synchronous PATH scan the executable finder needs, implemented over the
// filesystem so it pulls in no process-spawning dependency.

import { existsSync, statSync } from 'fs'
import { delimiter, join } from 'path'

function isExecutableFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/**
 * Resolve an executable name against PATH, returning its absolute path or
 * undefined. On Windows, candidate extensions come from PATHEXT.
 */
export function whichSync(exe: string): string | undefined {
  // Already a path with a separator — check it directly.
  if (exe.includes('/') || exe.includes('\\')) {
    return existsSync(exe) ? exe : undefined
  }

  const pathDirs = (process.env.PATH || '').split(delimiter).filter(Boolean)
  const isWindows = process.platform === 'win32'
  const exts = isWindows
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
        .split(';')
        .filter(Boolean)
    : ['']

  for (const dir of pathDirs) {
    for (const ext of exts) {
      const candidate = join(dir, exe + ext)
      if (isExecutableFile(candidate)) {
        return candidate
      }
    }
  }
  return undefined
}

/**
 * Asynchronous `which`: resolve an executable name against PATH, returning its
 * absolute path or null. Uses Bun.which when available, else the PATH scan.
 */
export async function which(command: string): Promise<string | null> {
  if (typeof Bun !== 'undefined' && typeof Bun.which === 'function') {
    return Bun.which(command)
  }
  return whichSync(command) ?? null
}
