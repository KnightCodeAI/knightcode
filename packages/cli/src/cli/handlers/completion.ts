/**
 * `knightcode completion <shell>` — generate a shell completion script for
 * bash, zsh, or fish, written to stdout (or a file via --output).
 *
 * The flag list is derived from the same `buildProgram` definition the parser
 * uses, so completions stay in sync with the real CLI surface automatically.
 * The three pre-parser subcommands (mcp/doctor/agents) and the
 * --permission-mode choices are the only hardcoded bits, since those live
 * outside the commander program.
 */

import { writeFileSync } from 'fs'
import { buildProgram } from '../parseArgs.js'
import { PERMISSION_MODES } from '../../types/permissions.js'

const BIN = 'knightcode'

export const COMPLETION_SHELLS = ['bash', 'zsh', 'fish'] as const
export type CompletionShell = (typeof COMPLETION_SHELLS)[number]

export function isCompletionShell(value: string): value is CompletionShell {
  return (COMPLETION_SHELLS as readonly string[]).includes(value)
}

/** Pre-parser subcommands routed in main.tsx (not part of the commander program). */
const SUBCOMMANDS: Array<{ name: string; desc: string }> = [
  { name: 'mcp', desc: 'Configure MCP servers' },
  { name: 'doctor', desc: 'Check BYOK setup health' },
  { name: 'agents', desc: 'List configured agents' },
]

type FlagSpec = {
  long: string
  short?: string
  desc: string
  takesArg: boolean
}

/** Collect the top-level flags from the shared commander program definition. */
function collectFlags(version: string): FlagSpec[] {
  const program = buildProgram(version)
  const flags: FlagSpec[] = []
  const seen = new Set<string>()

  for (const opt of program.options) {
    if (!opt.long || seen.has(opt.long)) continue
    seen.add(opt.long)
    flags.push({
      long: opt.long,
      short: opt.short ?? undefined,
      // Collapse whitespace; descriptions are multi-line in the source.
      desc: (opt.description ?? '').replace(/\s+/g, ' ').trim(),
      takesArg: opt.required === true || opt.optional === true,
    })
  }

  // help/version are managed separately by commander and may not appear in
  // program.options depending on the version — add them if missing.
  if (!seen.has('--help')) {
    flags.push({ long: '--help', short: '-h', desc: 'Display help', takesArg: false })
  }
  if (!seen.has('--version')) {
    flags.push({
      long: '--version',
      short: '-v',
      desc: 'Output the version number',
      takesArg: false,
    })
  }
  return flags
}

/** A value-flag whose argument is a directory (gets path completion). */
function isDirArgFlag(long: string): boolean {
  return long === '--add-dir'
}

/** A value-flag whose argument has a fixed choice set. */
function choicesFor(long: string): string[] | undefined {
  return long === '--permission-mode' ? [...PERMISSION_MODES] : undefined
}

function generateBash(flags: FlagSpec[]): string {
  const subNames = SUBCOMMANDS.map(s => s.name).join(' ')
  const allFlags = flags
    .flatMap(f => (f.short ? [f.short, f.long] : [f.long]))
    .join(' ')
  const permModes = PERMISSION_MODES.join(' ')

  return `# bash completion for ${BIN}
# Install: source this file, or place it in your bash-completion.d directory.
_${BIN}_completions() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  case "$prev" in
    --permission-mode)
      COMPREPLY=( $(compgen -W "${permModes}" -- "$cur") )
      return ;;
    --add-dir)
      COMPREPLY=( $(compgen -d -- "$cur") )
      return ;;
    --model|--system-prompt|--append-system-prompt|--setting-sources|-r|--resume)
      # free-form value; no completion
      return ;;
  esac

  if [[ "$cur" == -* ]]; then
    COMPREPLY=( $(compgen -W "${allFlags}" -- "$cur") )
    return
  fi

  COMPREPLY=( $(compgen -W "${subNames}" -- "$cur") )
}
complete -F _${BIN}_completions ${BIN}
`
}

/**
 * Escape a description for use inside a zsh _arguments single-quoted `[...]`.
 * Single quotes use the close/escape/reopen idiom since zsh has no in-string
 * single-quote escape; the bracket/colon metachars are backslash-escaped.
 */
function zshEscapeDesc(desc: string): string {
  return desc.replace(/'/g, `'\\''`).replace(/[:\[\]]/g, m => `\\${m}`)
}

function generateZsh(flags: FlagSpec[]): string {
  const lines: string[] = []
  for (const f of flags) {
    const desc = zshEscapeDesc(f.desc)
    // Pair the short+long form (with mutual exclusion) so zsh offers one, not both.
    const names = f.short
      ? `'(${f.short} ${f.long})'{${f.short},${f.long}}`
      : `'${f.long}'`
    let tail: string
    if (!f.takesArg) {
      tail = `'[${desc}]'`
    } else {
      const choices = choicesFor(f.long)
      const action = choices
        ? `(${choices.join(' ')})`
        : isDirArgFlag(f.long)
          ? '_files -/'
          : ' '
      tail = `'[${desc}]:arg:${action}'`
    }
    lines.push(`    ${names}${tail} \\`)
  }
  const subValues = SUBCOMMANDS.map(s => `'${s.name}:${zshEscapeDesc(s.desc)}'`).join(' ')

  return `#compdef ${BIN}
# zsh completion for ${BIN}
_${BIN}() {
  _arguments -s -C \\
${lines.join('\n')}
    '1: :->command' \\
    '*:: :->args' && return

  case "$state" in
    command)
      _values 'command' ${subValues}
      ;;
  esac
}
_${BIN} "$@"
`
}

/** Escape a description for a fish single-quoted -d '...' string. */
function fishEscapeDesc(desc: string): string {
  return desc.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function generateFish(flags: FlagSpec[]): string {
  const lines: string[] = [`# fish completion for ${BIN}`, `complete -c ${BIN} -f`]

  for (const s of SUBCOMMANDS) {
    lines.push(
      `complete -c ${BIN} -n __fish_use_subcommand -a '${s.name}' -d '${fishEscapeDesc(s.desc)}'`,
    )
  }

  for (const f of flags) {
    const parts = [`complete -c ${BIN}`]
    if (f.short) parts.push(`-s ${f.short.replace(/^-/, '')}`)
    parts.push(`-l ${f.long.replace(/^--/, '')}`)
    parts.push(`-d '${fishEscapeDesc(f.desc)}'`)
    const choices = choicesFor(f.long)
    if (choices) {
      parts.push(`-x -a '${choices.join(' ')}'`)
    } else if (isDirArgFlag(f.long)) {
      parts.push('-r -F')
    } else if (f.takesArg) {
      parts.push('-r')
    }
    lines.push(parts.join(' '))
  }
  return `${lines.join('\n')}\n`
}

export function generateCompletionScript(
  shell: CompletionShell,
  version: string,
): string {
  const flags = collectFlags(version)
  switch (shell) {
    case 'bash':
      return generateBash(flags)
    case 'zsh':
      return generateZsh(flags)
    case 'fish':
      return generateFish(flags)
  }
}

export async function completionHandler(
  shell: string,
  opts: { output?: string },
  version: string,
): Promise<void> {
  if (!isCompletionShell(shell)) {
    process.stderr.write(
      `Unsupported shell '${shell}'. Supported: ${COMPLETION_SHELLS.join(', ')}.\n`,
    )
    process.exit(1)
  }

  const script = generateCompletionScript(shell, version)

  if (opts.output) {
    writeFileSync(opts.output, script, 'utf8')
    process.stderr.write(`Wrote ${shell} completion to ${opts.output}\n`)
  } else {
    process.stdout.write(script)
  }
}
