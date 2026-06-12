import { execFile } from 'child_process'

const MS_IN_SECOND = 1000
const SECONDS_IN_MINUTE = 60
const DEFAULT_TIMEOUT = 10 * SECONDS_IN_MINUTE * MS_IN_SECOND

type ExecFileOptions = {
  abortSignal?: AbortSignal
  timeout?: number
  preserveOutputOnError?: boolean
  useCwd?: boolean
  env?: NodeJS.ProcessEnv
  stdin?: 'ignore' | 'inherit' | 'pipe'
  input?: string
}

/**
 * execFile, but always resolves (never throws). Non-zero exits and spawn
 * failures come back as { code, error } instead of rejections, so callers can
 * fire-and-forget platform helpers (clipboard, tmux, ...) without try/catch.
 */
export function execFileNoThrow(
  file: string,
  args: string[],
  options: ExecFileOptions = {},
): Promise<{ stdout: string; stderr: string; code: number; error?: string }> {
  const {
    abortSignal,
    timeout = DEFAULT_TIMEOUT,
    preserveOutputOnError = true,
    env,
    input,
  } = options

  return new Promise(resolve => {
    const child = execFile(
      file,
      args,
      {
        signal: abortSignal,
        timeout,
        env,
        maxBuffer: 1_000_000,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          const code =
            typeof error.code === 'number' ? error.code : (1 as number)
          if (preserveOutputOnError) {
            resolve({
              stdout: stdout || '',
              stderr: stderr || '',
              code,
              error: error.message,
            })
          } else {
            resolve({ stdout: '', stderr: '', code })
          }
          return
        }
        resolve({ stdout, stderr, code: 0 })
      },
    )

    if (input !== undefined && child.stdin) {
      child.stdin.write(input)
      child.stdin.end()
    }
  })
}
