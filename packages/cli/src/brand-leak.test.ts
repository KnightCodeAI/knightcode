import { test, expect } from 'bun:test'
import { Glob } from 'bun'
import { readFileSync } from 'fs'

const BANNED = /claude|anthropic|tengu|clawd/i

// Allowlist: occurrences that legitimately contain a banned token because they
// are functional/factual identifiers, not branding. Must stay in sync with the
// rebrand sweep's allowlist (a drift between the two is itself a bug).
const ALLOW: RegExp[] = [
  /@anthropic-ai\/sdk/, // npm dependency specifier
  /anthropic\/claude-/, // OpenRouter model slug
  /"Claude (Opus|Sonnet|Haiku|Fable)/, // model display label
  /VERTEX_REGION_CLAUDE_/, // allowlisted model-region env
  /claude-(opus|sonnet|haiku|fable|3|4)/, // model-id prefixes
  // The `Anthropic` SDK type/namespace/constructor — the default export of
  // @anthropic-ai/sdk, a functional identifier like the package specifier.
  /(?:[<:(]|new |as |typeof |Promise<)\s*Anthropic\b/,
  /\bAnthropic[>.]/,
  // Test-only idioms that verify the rebrand: negative brand assertions and the
  // legacy-CLAUDE.md ignore fixture must reference the old token by design.
  /\.not\.toContain\(/,
  /a legacy CLAUDE\.md/,
  /legacy should be ignored/,
]

function allowed(line: string): boolean {
  return ALLOW.some(a => a.test(line))
}

test('no Claude/Anthropic/tengu/clawd brand tokens remain in shipped src', async () => {
  const offenders: string[] = []
  const glob = new Glob('**/*.{ts,tsx}')
  for await (const f of glob.scan({ cwd: import.meta.dir })) {
    if (f.includes('brand-leak.test')) continue
    const lines = readFileSync(`${import.meta.dir}/${f}`, 'utf8').split('\n')
    lines.forEach((ln, i) => {
      if (BANNED.test(ln) && !allowed(ln)) {
        offenders.push(`${f}:${i + 1}: ${ln.trim()}`)
      }
    })
  }
  expect(offenders).toEqual([])
})

test('no .claude/ path literals remain', async () => {
  const offenders: string[] = []
  const glob = new Glob('**/*.{ts,tsx}')
  for await (const f of glob.scan({ cwd: import.meta.dir })) {
    if (f.includes('brand-leak.test')) continue
    const txt = readFileSync(`${import.meta.dir}/${f}`, 'utf8')
    if (/\.claude\//.test(txt)) offenders.push(f)
  }
  expect(offenders).toEqual([])
})
