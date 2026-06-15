import { tmpdir } from 'os'
import { join } from 'path'
import type { ShellProvider } from './shellProvider.js'

// Minimal bash provider. The full machinery — shell-snapshot sourcing, the
// prefix command, extglob handling, eval-wrapping, tmux socket setup, and the
// session-environment script — lands with BashTool. PowerShell (Windows
// primary) never resolves this provider; it exists so Shell.ts's static import
// resolves and a trivial foreground bash command still runs with cwd tracking.
export async function createBashShellProvider(
  binShell: string,
): Promise<ShellProvider> {
  return {
    type: 'bash',
    shellPath: binShell,
    detached: true,

    async buildExecCommand(
      command: string,
      opts: { id: number | string; sandboxTmpDir?: string; useSandbox: boolean },
    ): Promise<{ commandString: string; cwdFilePath: string }> {
      const cwdFilePath = join(tmpdir(), `knightcode-pwd-${opts.id}`)
      const escaped = cwdFilePath.replace(/'/g, `'\\''`)
      // Run the command, capture its exit code, record the resulting cwd for
      // Shell.ts to read back, then exit with the original code.
      const commandString = `${command}\n__knightcode_ec=$?\npwd -P >| '${escaped}'\nexit $__knightcode_ec`
      return { commandString, cwdFilePath }
    },

    getSpawnArgs(commandString: string): string[] {
      return ['-c', commandString]
    },

    async getEnvironmentOverrides(): Promise<Record<string, string>> {
      return {}
    },
  }
}
