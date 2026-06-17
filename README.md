<!-- AUTO-GENERATED — do not edit. Source: packages/cli/README.md plus the README_SUFFIX in scripts/sync-root-docs.ts. Run `bun run sync:docs` to regenerate. -->

# @knightcodeai/cli

`knightcode` — a local-first, bring-your-own-key AI coding CLI for your terminal.

## Install

```bash
npm install -g @knightcodeai/cli
```

You don't need Bun — it's bundled into the platform binary. The small launcher
(`bin/knightcode`) that spawns it runs on Node.js (>=18), which you already have
if you installed with npm. The right platform binary installs automatically as
an optional dependency.

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

## Repository layout

This is a [Turborepo](https://turborepo.dev/) monorepo managed with
[bun](https://bun.sh/).

| Path | Description |
| ---- | ----------- |
| `packages/cli` | The `@knightcodeai/cli` package — the `knightcode` CLI source |
| `packages/cli-*` | Per-platform prebuilt binaries published as optional deps |
| `packages/shared` | Shared library code used across packages |
| `packages/ui` | Shared React component library |
| `packages/eslint-config`, `packages/typescript-config` | Shared tooling config |
| `apps/web` | Marketing / docs website |

## Development

Requires [bun](https://bun.sh/) (`bun@1.3.3`) and Node.js >=20.

```bash
bun install        # install dependencies
bun run dev:cli    # run the CLI from source with watch mode
bun run build:cli  # build the standalone binary
bun run link:cli   # build and link `knightcode` globally
```

Other useful scripts:

```bash
bun run lint         # lint all packages
bun run check-types  # type-check all packages
bun run format       # format with Prettier
bun run sync:docs    # regenerate the root README.md and CHANGELOG.md
```

## Releases

Releases are managed with [Changesets](https://github.com/changesets/changesets).
To record a change for the next release:

```bash
bunx changeset
```

Pick a bump type (patch/minor/major) and write one sentence. Commit the generated
`.changeset/*.md` file with your PR. On merge to `main`, the Changesets bot opens a
"Version Packages" PR; merging that PR publishes all `@knightcodeai/cli*` packages.

See [`CHANGELOG.md`](./CHANGELOG.md) for the release history.

## License

[Apache-2.0](./LICENSE). Copyright 2026 KnightCodeAI.
