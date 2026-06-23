// Command-line argument parsing for the interactive entrypoint.
//
// This is the BYOK-relevant slice of the upstream commander program: the flags
// that configure an interactive session. The cloud/SDK surface (headless print
// protocol, auth/plugin/server/ssh/doctor/update subcommands) is out of scope
// for a BYOK build — `-p/--print` is recognized and reported as unsupported
// rather than silently dropping into the REPL.
//
// parseCliArgs is pure (no side effects) and unit-tested; applying the parsed
// options to runtime state happens in main.tsx.

import { Command, Option } from 'commander'
import { PERMISSION_MODES } from '../types/permissions.js'
import type { PermissionMode } from '../utils/permissions/PermissionMode.js'

export type CliOptions = {
  /** Positional prompt to pre-submit on launch. */
  prompt?: string
  /** --print / -p : headless mode (unsupported in this build). */
  print: boolean
  /** --model <m> : alias or full model id for the session. */
  model?: string
  /** --permission-mode <mode>. */
  permissionMode?: PermissionMode
  /** --dangerously-skip-permissions : bypass all permission checks. */
  dangerouslySkipPermissions: boolean
  /** --add-dir <dirs...> : extra directories tools may access. */
  addDir: string[]
  /** --append-system-prompt <p>. */
  appendSystemPrompt?: string
  /** --system-prompt <p> : replace the default system prompt. */
  systemPrompt?: string
  /** --setting-sources <a,b,c>. */
  settingSources?: string
  /** --verbose. */
  verbose: boolean
  /** --bare : minimal mode (sets KNIGHTCODE_CODE_SIMPLE). */
  bare: boolean
  /** --disable-slash-commands. */
  disableSlashCommands: boolean
  /** --strict-mcp-config. */
  strictMcpConfig: boolean
  /** -c / --continue : resume the most recent conversation in this directory. */
  continueSession: boolean
  /**
   * -r / --resume [value] : `true` opens the interactive picker, a string is a
   * session id (UUID) or a custom-title search term. `undefined` when absent.
   */
  resume?: string | true
  /** --fork-session : on resume, mint a fresh session id instead of reusing it. */
  forkSession: boolean
}

/**
 * Build the commander program. Exported so the parser and `--help` share one
 * definition. `exitOverride` lets callers (and tests) catch help/version/parse
 * errors instead of the process exiting.
 */
export function buildProgram(version: string): Command {
  const program = new Command()
  program
    .name('knightcode')
    .description(
      'KnightCode - starts an interactive session by default. ' +
        'Pass a prompt to pre-submit it on launch.',
    )
    .argument('[prompt]', 'Prompt to pre-submit on launch')
    .helpOption('-h, --help', 'Display help')
    .version(version, '-v, --version', 'Output the version number')
    .option(
      '-p, --print',
      'Print response and exit (headless). Not available in this build.',
      () => true,
    )
    .option('--verbose', 'Enable verbose output', () => true)
    .option(
      '--bare',
      'Minimal mode: skip hooks, auto-memory, background prefetches, and ' +
        'KNIGHTCODE.md auto-discovery (sets KNIGHTCODE_CODE_SIMPLE=1).',
      () => true,
    )
    .option(
      '--dangerously-skip-permissions',
      'Bypass all permission checks. Recommended only for sandboxes.',
      () => true,
    )
    .option('--disable-slash-commands', 'Disable all skills/slash commands', () => true)
    .option(
      '--strict-mcp-config',
      'Only use MCP servers from --mcp-config, ignoring other MCP configuration',
      () => true,
    )
    .option(
      '--add-dir <directories...>',
      'Additional directories to allow tool access to',
    )
    .option(
      '--model <model>',
      "Model for this session: an alias (e.g. 'sonnet', 'opus') or a full " +
        'model id.',
    )
    .option(
      '--system-prompt <prompt>',
      'System prompt to use for the session (replaces the default)',
    )
    .option(
      '--append-system-prompt <prompt>',
      'Append a system prompt to the default system prompt',
    )
    .option(
      '--setting-sources <sources>',
      'Comma-separated list of setting sources to load (user, project, local)',
    )
    .addOption(
      new Option('--permission-mode <mode>', 'Permission mode for the session')
        .choices([...PERMISSION_MODES]),
    )
    .option(
      '-c, --continue',
      'Continue the most recent conversation in the current directory',
      () => true,
    )
    .option(
      '-r, --resume [value]',
      'Resume a conversation by session ID, or open the interactive picker ' +
        '(optionally with a search term)',
      value => value || true,
    )
    .option(
      '--fork-session',
      'When resuming, create a new session ID instead of reusing the original ' +
        '(use with --resume or --continue)',
      () => true,
    )
  return program
}

/**
 * Parse argv (without the leading [node, script]) into CliOptions. Pure: throws
 * a CommanderError on parse failure / help / version instead of exiting, so the
 * caller decides what to do.
 */
export function parseCliArgs(argv: string[], version = '0.0.0'): CliOptions {
  const program = buildProgram(version)
  program.exitOverride()
  program.parse(argv, { from: 'user' })

  const opts = program.opts()
  const prompt = program.args[0]

  return {
    prompt: prompt && prompt.length > 0 ? prompt : undefined,
    print: opts.print === true,
    model: typeof opts.model === 'string' ? opts.model : undefined,
    permissionMode: opts.permissionMode as PermissionMode | undefined,
    dangerouslySkipPermissions: opts.dangerouslySkipPermissions === true,
    addDir: Array.isArray(opts.addDir) ? opts.addDir : [],
    appendSystemPrompt:
      typeof opts.appendSystemPrompt === 'string'
        ? opts.appendSystemPrompt
        : undefined,
    systemPrompt:
      typeof opts.systemPrompt === 'string' ? opts.systemPrompt : undefined,
    settingSources:
      typeof opts.settingSources === 'string' ? opts.settingSources : undefined,
    verbose: opts.verbose === true,
    bare: opts.bare === true,
    disableSlashCommands: opts.disableSlashCommands === true,
    strictMcpConfig: opts.strictMcpConfig === true,
    continueSession: opts.continue === true,
    resume:
      opts.resume === true || typeof opts.resume === 'string'
        ? opts.resume
        : undefined,
    forkSession: opts.forkSession === true,
  }
}
