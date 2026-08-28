# Project Memory: KnightCode Guidelines

## Tech Stack

- Runtime: Bun (source runs directly; no build step for development)
- Language: TypeScript, ESM, `.ts` extensions in relative imports
- Package Manager: bun workspaces (`packages/*`)
- Terminal UI: `@knightcode/tui` — imperative components with
  `render(width): string[]`. **Not React.**

## Architecture

Derived from [pi](https://github.com/earendil-works/pi) (MIT, Mario Zechner),
rebranded and re-scoped to `@knightcode/*`. `packages/cli` is the binary;
`packages/ai` is the multi-provider layer; `packages/agent` is the loop and
harness.

Typechecking is a single root `tsc --noEmit` — the root `tsconfig.json` maps
every `@knightcode/*` specifier to package source, so there is no per-package
build to run first.

## Project Rules

1. Maintain existing style conventions (tabs, biome-style formatting).
2. Run `bun run check-types` before declaring a task finished.
3. Batch tools where possible.

## Names that are protocol, not branding — do not rebrand

- `"pi-messages"` — an `Api` union member baked into the model-catalog JSON
  under `packages/ai/src/providers/data/`. `PiMessages*` types name it.
- `originator: "pi"` (OpenAI Codex) and `referrer: "pi"` (xAI OAuth) — client
  identifiers those providers recognise. Changing them breaks auth.
- `radius.pi.dev` — the Radius provider's own gateway, a third-party service.

## Model catalog data

`packages/ai/src/providers/data/*.json` is generated upstream at build time and
is **not** in pi's source checkout. It was lifted from the published
`@earendil-works/pi-ai@0.84.3` tarball. Regenerating it needs pi's
`scripts/generate-models.ts` (network).

## Reference

The pre-port Claude Code tree is preserved, untracked, at
`shenanigans/cc-ui-reference/` — read it side-by-side when porting UI.
