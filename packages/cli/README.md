# @knightcodeai/cli

`knightcode` — a local-first, bring-your-own-key AI coding CLI for your terminal.

## Install

```bash
npm install -g @knightcodeai/cli
```

No prerequisites — the Bun runtime is bundled into the binary. The right
platform binary installs automatically as an optional dependency.

## Quick start

```bash
knightcode
```

On first run, set your OpenRouter API key from inside the app.

## Configuration

State lives in `~/.knightcode/` (sessions, settings, local SQLite database).

| Command / env var | Effect |
| ----------------- | ------ |
| `knightcode --version` | Print the installed version |
| `knightcode doctor` | Print diagnostics (config, database, API key, runtime) |
| `KNIGHTCODE_NO_UPDATE_CHECK=1` | Disable the background update check |

## Supported platforms

Linux (x64, arm64), macOS (x64, arm64), Windows (x64).
