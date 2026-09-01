# Live version & changelog on the website

**Date:** 2026-06-17
**Status:** Approved design — ready for implementation plan

## Problem

The website shows a stale release badge (`ALPHA V0.2.0`) even though the CLI is published at `0.2.1`. The badge is baked in at build time:

```ts
// apps/web/lib/site.ts
import cliPackage from "../../../packages/cli/package.json"
export const VERSION = cliPackage.version
```

`VERSION` is a module constant resolved when Vercel builds the site. The `0.2.1` bump touched `packages/**` but not `apps/web/**`, so Vercel never rebuilt and the badge froze at the version from the last `apps/web` build.

The changelog **list** is already live (it fetches `CHANGELOG.md` from GitHub `main` at request time), but the changelog page's own version badge uses the same build-time `VERSION`, and its lead copy still claims the page "will stay static until release automation is wired up."

## Goal

Whenever a change merges to `main`, the CLI auto-publishes to npm within ~2 minutes via GitHub Actions (changesets). GitHub `main` and npm are therefore effectively simultaneous. The site should reflect the new version **and** changelog automatically, without a manual redeploy.

## Source of truth

**The live `packages/cli/CHANGELOG.md` on GitHub `main`** — a single fetch feeds both values:

- **Version** = the top `## X.Y.Z` heading of that file.
- **Changelog** = the parsed entries of that same file.

This guarantees the version badge can never disagree with the changelog list, because both derive from one fetch. The changelog page already fetches this file via `lib/changelog-parser.ts`; Next.js dedupes the fetch across all callers within a request.

(The repo also has a root `CHANGELOG.md`, auto-generated from `packages/cli/CHANGELOG.md` via `sync:docs`. The site uses the `packages/cli/` one — the existing source.)

## Freshness

`revalidate: 600` (10 minutes) on the GitHub fetch. ISR caches the fetched file for 10 minutes; the first request after the window triggers a background refetch. A new release becomes visible within ~10 minutes of the merge/publish. The existing changelog fetch (currently `3600`) is lowered to `600` to match.

## Architecture

The site is a server-rendered Next.js App Router app on Vercel (no `output: 'export'`; it uses `rewrites()`), so server components can fetch at request time with ISR.

### New: `getLatestVersion()`

Add to `apps/web/lib/version.ts` (or alongside the existing changelog lib):

```ts
import cliPackage from "../../../packages/cli/package.json"
import { getChangelog } from "./changelog"

export const FALLBACK_VERSION = cliPackage.version

export async function getLatestVersion(): Promise<string> {
  try {
    const entries = await getChangelog()
    return entries[0]?.version ?? FALLBACK_VERSION
  } catch {
    return FALLBACK_VERSION
  }
}
```

- Reuses the existing `getChangelog()` fetch (same URL → deduped/cached by Next), so the version always matches the rendered changelog list.
- Falls back to the bundled `packages/cli/package.json` version if the fetch fails or the changelog is empty — the badge degrades to the build-time version, never blank, never an error.

### Consumers

Each consumer either self-fetches (server component) or receives one prop (client component, from its already-async server parent). Next's request-level fetch cache collapses all `getChangelog()`/`getLatestVersion()` calls in a single render into one network request.

| File | Type | Change |
|------|------|--------|
| `lib/version.ts` | lib | New `getLatestVersion()` + `FALLBACK_VERSION`. |
| `lib/site.ts` | lib | Keep `VERSION` as the build-time fallback (re-export `FALLBACK_VERSION`), so any missed spot still renders a sane value. |
| `lib/changelog-parser.ts` | lib | Lower `revalidate` from `3600` to `600`. |
| `components/site/footer.tsx` | server | Make `async`; `const version = await getLatestVersion()` internally. No prop. (Rendered inside `PageShell`, so this avoids threading through every page.) |
| `components/site/hero.tsx` | client | Accept `version?: string` prop, default `FALLBACK_VERSION`. |
| `components/site/download.tsx` | client | Accept `version?: string` prop, default `FALLBACK_VERSION`. |
| `app/page.tsx` | server | Make `async`; fetch version once; pass to `<Hero version=…/>` and `<Download version=…/>`; use it for the `softwareVersion` JSON-LD field. |
| `app/about/page.tsx` | server | Make `async`; `await getLatestVersion()` for the `v{…}` meta. |
| `app/security/page.tsx` | server | Make `async`; `await getLatestVersion()` for the `Latest - v{…}` meta. |
| `app/opengraph-image.tsx` | edge route | **Unchanged — stays on build-time `VERSION`.** This route runs on the edge runtime; `getLatestVersion()` transitively imports the changelog parser's Node `fs`, which can't bundle for edge. The OG card is a social preview regenerated each deploy, so a build-time version is acceptable. |
| `app/changelog/page.tsx` | server | Use `changelog[0]?.version ?? FALLBACK_VERSION` for the `Latest - v{…}` badge (it already loads `changelog`); drop the `VERSION` import; update the lead copy to remove the "stays static" claim. |

### Changelog page copy

Line 92's lead changes from:

> "A manually curated view of notable alpha changes. It is intentionally shorter than the raw commit history and will stay static until release automation is wired up."

to something like:

> "Release notes pulled live from the project changelog. Shorter than the raw commit history — the notable changes per version."

## Data flow

```
GitHub main: packages/cli/CHANGELOG.md
        │  (fetch, revalidate 600)
        ▼
  getChangelog()  ──────────────┐
        │                        │
        ▼                        ▼
  changelog list           getLatestVersion()  ── FALLBACK_VERSION (build-time) on failure
  (changelog page)               │
                                 ├─► footer (self-fetch)
                                 ├─► about / security (self-fetch)
                                 └─► page.tsx ─► Hero, Download (props)

  (OG image route is edge-runtime; stays on build-time VERSION — fs can't bundle for edge.)

NOTE: FALLBACK_VERSION lives in site.ts (pure JSON import, no Node deps) so client
components and the edge OG route can import it safely. version.ts depends on site.ts,
never the reverse — importing getLatestVersion pulls in Node `fs` and is server-only.
```

## Error handling

- Fetch failure / non-200 / empty changelog → `getLatestVersion()` returns `FALLBACK_VERSION`; `getChangelog()` already falls back to the local file then `[]`.
- Client components default their `version` prop to `FALLBACK_VERSION`, so they render correctly even if a parent forgets to pass it.

## Out of scope

- No npm registry fetch (GitHub `main` ⇄ npm are simultaneous; one source is enough).
- No changes to the publish workflow or changeset config.
- ~~No redesign of the changelog parser beyond the `revalidate` value.~~ **(Superseded 2026-06-17):** the parser was rewritten to handle the changesets-generated format — see the follow-up note below.

## Follow-up: changelog parser rewrite (2026-06-17)

The original parser targeted hand-curated "Keep a Changelog" markdown, but `packages/cli/CHANGELOG.md` is changesets-generated: bump headers (`### Patch Changes`), `- <hash>:` changeset bullets, and nested `### Added/Changed/Fixed/Removed` sections whose content is often paragraphs rather than bullets. The old parser mis-mapped bump headers to kinds and silently dropped paragraph content, so v0.2.1 rendered as gutted, mis-grouped fragments with literal `### Added` text.

`parseChangelog()` was extracted as a pure, tested function and rewritten to: ignore bump headers, split each version into changesets, file each changeset's content under its nested kind sections (paragraphs **and** bullet lists), use the first changeset's lead summary as the version `highlight`, and bucket a section-less changeset under the bump-type's fallback kind (minor→Added, patch→Fixed, major→Changed). `ChangeKind` gained `"Removed"` (rose badge in the changelog UI). Covered by `apps/web/lib/changelog-parser.test.ts` (`bun test`).

## Verification

- Local: `bun run dev`, confirm hero/footer/download/about/security/changelog/OG all show `0.2.1` (top of the live CHANGELOG).
- Simulate a release: the badge and list update on next request after the 10-minute window without a redeploy.
- Fallback: with the network blocked, the site renders the bundled `package.json` version instead of erroring.
- `bun run typecheck` passes (async server components, new prop types).
