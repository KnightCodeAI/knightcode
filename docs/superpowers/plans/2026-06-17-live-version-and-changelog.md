# Live Version & Changelog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the website's version badge and changelog reflect the latest release automatically, sourced live from `packages/cli/CHANGELOG.md` on GitHub `main`, without a manual redeploy.

**Architecture:** A single ISR-cached fetch of the live CHANGELOG (already performed by `getChangelog()`) feeds both the changelog list and the version. A new `getLatestVersion()` returns the top entry's version with a build-time fallback. Server components self-fetch; the two client components receive the version as a prop from their async parent.

**Tech Stack:** Next.js App Router (server-rendered on Vercel), TypeScript, Bun.

## Global Constraints

- Single source of truth: `https://raw.githubusercontent.com/KnightCodeAI/knightcode/main/packages/cli/CHANGELOG.md` (already fetched by `lib/changelog-parser.ts`).
- ISR `revalidate: 600` (10 minutes) on the GitHub fetch.
- Every version consumer falls back to the bundled `packages/cli/package.json` version (`FALLBACK_VERSION`) on any fetch failure — never blank, never throws.
- No npm registry fetch; no publish-workflow or changeset changes.
- Verification gate per task: `bun run typecheck` from `apps/web` (no component test harness exists in this app).
- Git commits are left to the user; do not run `git commit`.

---

### Task 1: `getLatestVersion()` helper + fallback

**Files:**
- Create: `apps/web/lib/version.ts`
- Modify: `apps/web/lib/site.ts:1-3`

**Interfaces:**
- Consumes: `getChangelog()` from `apps/web/lib/changelog.ts` (returns `ChangelogEntry[]`, where `[0].version` is the newest version string).
- Produces: `getLatestVersion(): Promise<string>` and `FALLBACK_VERSION: string` from `apps/web/lib/version.ts`.

- [ ] **Step 1: Create `apps/web/lib/version.ts`**

```ts
import cliPackage from "../../../packages/cli/package.json"
import { getChangelog } from "./changelog"

// Build-time version, used as a safe fallback when the live changelog fetch
// fails or returns nothing. The live value comes from getLatestVersion().
export const FALLBACK_VERSION = cliPackage.version

// Latest published version, derived from the top entry of the live changelog
// (the same fetch the changelog page uses, so the two never disagree).
export async function getLatestVersion(): Promise<string> {
  try {
    const entries = await getChangelog()
    return entries[0]?.version ?? FALLBACK_VERSION
  } catch {
    return FALLBACK_VERSION
  }
}
```

- [ ] **Step 2: Keep `VERSION` in `site.ts` as the build-time fallback and re-export `FALLBACK_VERSION`**

Replace `apps/web/lib/site.ts` lines 1-3:

```ts
import cliPackage from "../../../packages/cli/package.json"

// Build-time version. Prefer the live value from getLatestVersion(); this
// remains as the fallback and for any non-async render path.
export const VERSION = cliPackage.version
export { FALLBACK_VERSION } from "./version"
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && bun run typecheck`
Expected: PASS (no usages changed yet).

---

### Task 2: Lower changelog revalidate window to 10 minutes

**Files:**
- Modify: `apps/web/lib/changelog-parser.ts:33`

- [ ] **Step 1: Change the revalidate value**

In `apps/web/lib/changelog-parser.ts`, change the fetch options:

```ts
    const res = await fetch("https://raw.githubusercontent.com/KnightCodeAI/knightcode/main/packages/cli/CHANGELOG.md", {
      next: { revalidate: 600 }, // Cache for 10 minutes
    })
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && bun run typecheck`
Expected: PASS.

---

### Task 3: Footer self-fetches the live version

**Files:**
- Modify: `apps/web/components/site/footer.tsx:6,37,58`

**Interfaces:**
- Consumes: `getLatestVersion()` from `apps/web/lib/version.ts`.

`SiteFooter` is a server component rendered inside `PageShell` and directly in `app/page.tsx`. Making it async lets it fetch its own version with no prop-threading through every page.

- [ ] **Step 1: Import `getLatestVersion`, drop the `VERSION` import**

Change line 6 from:

```ts
import { SITE, VERSION, PRODUCT_LINKS } from "@/lib/site"
```

to:

```ts
import { SITE, PRODUCT_LINKS } from "@/lib/site"
import { getLatestVersion } from "@/lib/version"
```

- [ ] **Step 2: Make the component async and fetch the version**

Change line 37 from `export function SiteFooter() {` to:

```ts
export async function SiteFooter() {
  const version = await getLatestVersion()
```

- [ ] **Step 3: Render the live version**

Change line 58 from `v{VERSION} - Alpha` to `v{version} - Alpha`.

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && bun run typecheck`
Expected: PASS. (An `async` server component is valid; callers `await` it implicitly via JSX.)

---

### Task 4: Hero & Download accept a `version` prop

**Files:**
- Modify: `apps/web/components/site/hero.tsx:16,19,47,53`
- Modify: `apps/web/components/site/download.tsx:17,39,70`

**Interfaces:**
- Produces: `Hero({ version }: { version?: string })` and `Download({ version }: { version?: string })`. Both default to `FALLBACK_VERSION`.
- Consumes: `FALLBACK_VERSION` from `apps/web/lib/version.ts`.

These are `"use client"` components and cannot fetch server-side; they receive `version` from `app/page.tsx` (Task 5) and default to the bundled version.

- [ ] **Step 1: Hero — swap the `VERSION` import for `FALLBACK_VERSION`**

Change `hero.tsx` line 16 from:

```ts
import { INSTALL_COMMAND, NPM_PACKAGE, SITE, VERSION } from "@/lib/site"
```

to:

```ts
import { INSTALL_COMMAND, NPM_PACKAGE, SITE } from "@/lib/site"
import { FALLBACK_VERSION } from "@/lib/version"
```

- [ ] **Step 2: Hero — accept the prop**

Change line 19 from `export function Hero() {` to:

```ts
export function Hero({ version = FALLBACK_VERSION }: { version?: string }) {
```

- [ ] **Step 3: Hero — use `version` in both spots**

Change line 47's release link to use `version`:

```ts
            href={`${SITE.githubReleases}/tag/${encodeURIComponent(`${NPM_PACKAGE}@${version}`)}`}
```

Change line 53 from `<span>Alpha v{VERSION}</span>` to `<span>Alpha v{version}</span>`.

- [ ] **Step 4: Download — swap the import**

Change `download.tsx` line 17 from:

```ts
import { INSTALL_COMMAND, RUN_COMMAND, SITE, VERSION } from "@/lib/site"
```

to:

```ts
import { INSTALL_COMMAND, RUN_COMMAND, SITE } from "@/lib/site"
import { FALLBACK_VERSION } from "@/lib/version"
```

- [ ] **Step 5: Download — accept the prop and use it**

Change line 39 from `export function Download() {` to:

```ts
export function Download({ version = FALLBACK_VERSION }: { version?: string }) {
```

Change line 70 from `<SectionEyebrow>06 - Install - Alpha v{VERSION}</SectionEyebrow>` to `<SectionEyebrow>06 - Install - Alpha v{version}</SectionEyebrow>`.

- [ ] **Step 6: Typecheck**

Run: `cd apps/web && bun run typecheck`
Expected: PASS (`app/page.tsx` still renders `<Hero />`/`<Download />` with no prop — valid since `version` is optional).

---

### Task 5: Home page fetches once, threads to Hero/Download/JSON-LD

**Files:**
- Modify: `apps/web/app/page.tsx:10,31,39,60,263`

**Interfaces:**
- Consumes: `getLatestVersion()` from `apps/web/lib/version.ts`.

- [ ] **Step 1: Import `getLatestVersion`, drop `VERSION`**

Change line 10 from:

```ts
import { SITE, VERSION } from "@/lib/site"
```

to:

```ts
import { SITE } from "@/lib/site"
import { getLatestVersion } from "@/lib/version"
```

- [ ] **Step 2: Make the page async and fetch the version**

Change line 31 from `export default function HomePage() {` to:

```ts
export default async function HomePage() {
  const version = await getLatestVersion()
```

- [ ] **Step 3: Use `version` in JSON-LD**

Change line 39 from `softwareVersion: VERSION,` to `softwareVersion: version,`.

- [ ] **Step 4: Pass `version` to Hero and Download**

Change line 60 `<Hero />` to `<Hero version={version} />`.
Change line 263 `<Download />` to `<Download version={version} />`.

- [ ] **Step 5: Typecheck**

Run: `cd apps/web && bun run typecheck`
Expected: PASS.

---

### Task 6: About, Security, and OG image self-fetch the version

**Files:**
- Modify: `apps/web/app/about/page.tsx:8,24,33`
- Modify: `apps/web/app/security/page.tsx:8,16,25`
- Modify: `apps/web/app/opengraph-image.tsx:1,9,57`

**Interfaces:**
- Consumes: `getLatestVersion()` from `apps/web/lib/version.ts`.

- [ ] **Step 1: About — import, make async, use live version**

In `about/page.tsx`: change line 8 from `import { SITE, VERSION } from "@/lib/site"` to:

```ts
import { SITE } from "@/lib/site"
import { getLatestVersion } from "@/lib/version"
```

Change line 24 from `export default function AboutPage() {` to:

```ts
export default async function AboutPage() {
  const version = await getLatestVersion()
```

Change line 33 from `<span>v{VERSION}</span>` to `<span>v{version}</span>`.

- [ ] **Step 2: Security — same treatment**

In `security/page.tsx`: change line 8 import the same way:

```ts
import { SITE } from "@/lib/site"
import { getLatestVersion } from "@/lib/version"
```

Change line 16 from `export default function SecurityPage() {` to:

```ts
export default async function SecurityPage() {
  const version = await getLatestVersion()
```

Change line 25 from `<span>Latest - v{VERSION}</span>` to `<span>Latest - v{version}</span>`.

- [ ] **Step 3: OG image — leave unchanged**

`opengraph-image.tsx` has `export const runtime = "edge"`. `getLatestVersion()` transitively imports the changelog parser's Node `fs`, which cannot bundle for the edge runtime (the build fails with a module-not-found on `fs`). Keep this route on the build-time `VERSION` import — the OG card is a social preview regenerated each deploy, so a build-time version is acceptable. **No change to this file.**

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && bun run typecheck`
Expected: PASS.

---

### Task 7: Changelog page derives version from its own data; fix copy

**Files:**
- Modify: `apps/web/app/changelog/page.tsx:9,85,92,95`

**Interfaces:**
- Consumes: `changelog` (already loaded via `getChangelog()`), `FALLBACK_VERSION`.

The page already `await getChangelog()`s. Use `changelog[0]?.version` for the badge so it matches the list, and drop the build-time `VERSION` import.

- [ ] **Step 1: Swap the import**

Change line 9 from `import { SITE, VERSION } from "@/lib/site"` to:

```ts
import { SITE } from "@/lib/site"
import { FALLBACK_VERSION } from "@/lib/version"
```

- [ ] **Step 2: Derive the version after loading the changelog**

After line 85 (`const changelog = await getChangelog()`), add:

```ts
  const version = changelog[0]?.version ?? FALLBACK_VERSION
```

- [ ] **Step 3: Use it in the badge**

Change line 95 from `<span>Latest - v{VERSION}</span>` to `<span>Latest - v{version}</span>`.

- [ ] **Step 4: Fix the misleading lead copy**

Change line 92's `lead` from:

```
lead="A manually curated view of notable alpha changes. It is intentionally shorter than the raw commit history and will stay static until release automation is wired up."
```

to:

```
lead="Release notes pulled live from the project changelog — the notable changes per version, shorter than the raw commit history."
```

- [ ] **Step 5: Typecheck**

Run: `cd apps/web && bun run typecheck`
Expected: PASS.

---

### Task 8: Full build + visual verification

- [ ] **Step 1: Typecheck the whole app**

Run: `cd apps/web && bun run typecheck`
Expected: PASS.

- [ ] **Step 2: Production build**

Run: `cd apps/web && bun run build`
Expected: build succeeds; no errors about async components or the JSON-LD.

- [ ] **Step 3: Dev visual check**

Run `bun run dev`, then confirm the badge reads `v0.2.1` on: hero, footer, download eyebrow, about meta, security meta, changelog badge, and the OG image route. Confirm the changelog lead no longer says "stays static."

- [ ] **Step 4: Fallback check (optional)**

Temporarily make the GitHub fetch fail (e.g., offline) and confirm pages render `FALLBACK_VERSION` (the bundled `0.2.1`) instead of erroring.
