// Headless print-mode orchestrator (`-p` / `--print`). Owns everything
// `--print` needs beyond the turn itself: input resolution (positional arg vs.
// stdin), output formatting (text/json/stream-json), exit codes, and SIGINT.
// Delegates the actual agentic turn to `runHeadlessTurn` (headlessQuery.ts) and
// stays thin — this file has no query-loop knowledge of its own.

import type { SDKMessage } from 'src/entrypoints/agentSdkTypes.js'
import { createAbortController } from '../utils/abortController.js'
import { writeToStderr, writeToStdout } from '../utils/process.js'
import { installStreamJsonStdoutGuard } from '../utils/streamJsonStdoutGuard.js'
import { runHeadlessTurn } from './headlessQuery.js'
import type { CliOptions } from './parseArgs.js'

/** Injectable I/O for `runPrintMode`. Defaults hit the real process/turn runner. */
export type PrintModeIO = {
  stdout: (s: string) => void
  stderr: (s: string) => void
  readStdin: () => Promise<string>
  turnFn?: typeof runHeadlessTurn
}

/** Accumulates stdin into a single string. Only called when stdin isn't a TTY. */
async function defaultReadStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString('utf8')
}

type ResultMessage = SDKMessage & {
  type: 'result'
  subtype: 'success' | 'error_during_execution' | 'error_max_turns'
  is_error: boolean
  result: string
}

function isResultMessage(m: SDKMessage): m is ResultMessage {
  return m.type === 'result'
}

/**
 * Runs one headless `--print` turn end to end and returns the process exit
 * code (never throws for turn-level failures — `runHeadlessTurn` already
 * converts those into an `error_during_execution` result).
 */
export async function runPrintMode(
  cli: CliOptions,
  io: Partial<PrintModeIO> = {},
): Promise<number> {
  const stdout = io.stdout ?? writeToStdout
  const stderr = io.stderr ?? writeToStderr
  const readStdin = io.readStdin ?? defaultReadStdin
  const turnFn = io.turnFn ?? runHeadlessTurn
  const outputFormat = cli.outputFormat ?? 'text'

  // --- Validation -----------------------------------------------------
  if (outputFormat === 'stream-json' && !cli.verbose) {
    stderr(
      'Error: When using --print, --output-format=stream-json requires --verbose\n',
    )
    return 1
  }

  if (cli.continueSession || cli.resume !== undefined) {
    stderr(
      'Error: --continue/--resume are not yet supported with --print\n',
    )
    return 1
  }

  // --- Prompt resolution ------------------------------------------------
  let prompt = cli.prompt ?? ''
  if (!prompt && !process.stdin.isTTY) {
    prompt = (await readStdin()).trim()
  }
  if (!prompt) {
    stderr(
      'Error: Input must be provided either through stdin or as a prompt argument when using --print\n',
    )
    return 1
  }

  // --- Run the turn -------------------------------------------------
  if (outputFormat === 'stream-json') {
    // Must run before any stream-json output is emitted so a stray write
    // from elsewhere in the process can't corrupt the NDJSON stream.
    installStreamJsonStdoutGuard()
  }

  const abortController = createAbortController()
  const onSigint = () => abortController.abort()
  process.on('SIGINT', onSigint)

  // Only 'json' + '--verbose' needs the full message array; every other
  // format only reads the final result off the stream.
  const needsFullArray = outputFormat === 'json' && cli.verbose
  const messages: SDKMessage[] = []
  let lastMessage: SDKMessage | undefined

  try {
    for await (const message of turnFn({
      prompt,
      cwd: process.cwd(),
      model: cli.model,
      permissionMode: cli.permissionMode,
      dangerouslySkipPermissions: cli.dangerouslySkipPermissions,
      allowedTools: cli.allowedTools,
      disallowedTools: cli.disallowedTools,
      maxTurns: cli.maxTurns,
      systemPrompt: cli.systemPrompt,
      appendSystemPrompt: cli.appendSystemPrompt,
      verbose: cli.verbose,
      abortSignal: abortController.signal,
    })) {
      if (outputFormat === 'stream-json') {
        stdout(JSON.stringify(message) + '\n')
      }
      if (needsFullArray) {
        messages.push(message)
      }
      lastMessage = message
    }
  } finally {
    process.off('SIGINT', onSigint)
  }

  if (abortController.signal.aborted) {
    return 130
  }

  // --- Output formatting -------------------------------------------
  if (outputFormat === 'stream-json') {
    // Already streamed above.
    return lastMessage && isResultMessage(lastMessage) && lastMessage.is_error
      ? 1
      : lastMessage
        ? 0
        : 1
  }

  if (!lastMessage || !isResultMessage(lastMessage)) {
    stderr('Error: No result message received from the headless turn\n')
    return 1
  }

  if (outputFormat === 'json') {
    stdout(JSON.stringify(needsFullArray ? messages : lastMessage) + '\n')
    return lastMessage.is_error ? 1 : 0
  }

  // text (default)
  switch (lastMessage.subtype) {
    case 'success':
      stdout(
        lastMessage.result.endsWith('\n')
          ? lastMessage.result
          : lastMessage.result + '\n',
      )
      break
    case 'error_during_execution':
      stdout('Execution error')
      break
    case 'error_max_turns':
      stdout(`Error: Reached max turns (${cli.maxTurns})`)
      break
  }
  return lastMessage.is_error ? 1 : 0
}
