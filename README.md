# KnightCode

A local, BYOK terminal coding agent. Bring your own OpenRouter key (or any of
~39 other providers) and run an agent that reads files, runs commands, edits
code, and writes new files — with a token floor of roughly **1,100 tokens** per
request instead of the 20k+ typical of hosted agents.

```bash
npm install -g --ignore-scripts @knightcodeai/cli
export OPENROUTER_API_KEY=sk-or-...
knightcode
```

## Why

Most terminal agents spend 20–25k tokens on tool descriptions and system prompt
before you type anything. On a 200k model that is over 10% of the window every
turn, and open-weight models on gateways mostly do not get prompt caching — so
you pay it in latency and cash on every request. KnightCode's floor is ~1,100
tokens, measured.

## Layout

| Package | What it is |
| --- | --- |
| `packages/cli` | The `knightcode` binary — CLI, TUI mode, print mode, RPC mode, sessions, extensions, skills |
| `packages/ai` | Multi-provider LLM layer: ~39 providers, 20 API adapters, OAuth, model catalog |
| `packages/agent` | Agent loop, harness, compaction, session state, built-in tools |
| `packages/tui` | Terminal UI library with differential rendering |
| `packages/telemetry` | Vendor-neutral telemetry contracts |
| `packages/protocol` · `client` · `server` | RPC protocol and transports |
| `packages/session-backend-sqlite` | SQLite session storage backend |

## Development

```bash
bun install
bun run check-types          # tsc --noEmit across every package
bun run start                # run from source
bun run build:cli            # compile a single-file binary for this platform
```

Source runs directly under Bun — there is no build step for development. The
root `tsconfig.json` maps every `@knightcode/*` specifier to package source.

## Configuration

Config lives in `.knightcode/` (project) and `~/.knightcode/` (user). Provider
keys come from the environment (`OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, …)
or from `knightcode auth`. Run `knightcode --help` for flags and
`packages/cli/docs/` for the full documentation.

## License

MIT — see [LICENSE](LICENSE), which also carries the notices for the
third-party code included in this distribution.
