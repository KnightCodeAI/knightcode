import { describe, expect, it } from "bun:test"

import { parseChangelog } from "./changelog-parser"

// A trimmed but faithful slice of the changesets-generated CHANGELOG.md:
// - version heading + bump-type header
// - a changeset whose kind sections are glued to the bullet and written as paragraphs
// - a changeset with a lead summary followed by kind sections
// - an older version whose kind sections use bullet lists
// - an initial release with no kind sections at all
const SAMPLE = `# @knightcodeai/cli

## 0.2.1

### Patch Changes

- b529674: ### Added

  Memory follow-ups: feed recent tool usage into the recall selector.

  ### Fixed

  \`Tab\` mode cycle so it reaches \`AUTO\`.

  ### Removed

  Drop two unused dependencies from \`@knightcodeai/cli\`.

- 23a8811: Refresh the supported model catalog: add newer models.

  ### Added

  Refresh the supported model catalog with new OpenRouter models.

  ### Changed

  Default model is now \`nemotron\`.

## 0.2.0

### Minor Changes

- f2846df: Standalone query engine and Apache-2.0 licensing.

  This release replaces the React useChat harness.

  ### Added
  - **Standalone query engine.** A new engine loop drives a turn end-to-end,
    independent of the React render tree.
  - **Concurrency-aware tool scheduler.** Bounded concurrency.

  ### Fixed
  - **Quit behaviour:** \`/exit\` is now the only way to quit.

## 0.1.0

### Minor Changes

- 13af3df: Initial public release: \`knightcode\` ships as a compiled binary.
`

describe("parseChangelog (changesets format)", () => {
  const entries = parseChangelog(SAMPLE)
  const byVersion = (v: string) => entries.find((e) => e.version === v)!
  const items = (v: string, kind: string) =>
    byVersion(v).groups.find((g) => g.kind === kind)?.items ?? []

  it("returns every version, newest first", () => {
    expect(entries.map((e) => e.version)).toEqual(["0.2.1", "0.2.0", "0.1.0"])
  })

  it("never leaks literal markdown headings into items", () => {
    const allItems = entries.flatMap((e) => e.groups.flatMap((g) => g.items))
    for (const item of allItems) {
      expect(item).not.toContain("###")
    }
  })

  it("groups 0.2.1 paragraph sections under the correct kinds", () => {
    expect(items("0.2.1", "Added")).toEqual([
      "Memory follow-ups: feed recent tool usage into the recall selector.",
      "Refresh the supported model catalog with new OpenRouter models.",
    ])
    expect(items("0.2.1", "Fixed")).toEqual([
      "`Tab` mode cycle so it reaches `AUTO`.",
    ])
    expect(items("0.2.1", "Removed")).toEqual([
      "Drop two unused dependencies from `@knightcodeai/cli`.",
    ])
    expect(items("0.2.1", "Changed")).toEqual(["Default model is now `nemotron`."])
  })

  it("does not duplicate a changeset summary that has kind sections", () => {
    // The "Refresh the supported model catalog: add newer models." lead must NOT
    // appear as its own item — only the section content should.
    const all = byVersion("0.2.1").groups.flatMap((g) => g.items)
    expect(all).not.toContain("Refresh the supported model catalog: add newer models.")
  })

  it("uses the first changeset's lead summary as the version highlight", () => {
    expect(byVersion("0.2.0").highlight).toContain(
      "Standalone query engine and Apache-2.0 licensing.",
    )
  })

  it("parses bullet-list sections (0.2.0) preserving each bullet as an item", () => {
    expect(items("0.2.0", "Added")).toEqual([
      "**Standalone query engine.** A new engine loop drives a turn end-to-end, independent of the React render tree.",
      "**Concurrency-aware tool scheduler.** Bounded concurrency.",
    ])
    expect(items("0.2.0", "Fixed")).toEqual([
      "**Quit behaviour:** `/exit` is now the only way to quit.",
    ])
  })

  it("buckets a section-less changeset under the bump-type kind (minor -> Added)", () => {
    expect(items("0.1.0", "Added")).toEqual([
      "Initial public release: `knightcode` ships as a compiled binary.",
    ])
  })

  it("orders kinds Added, Changed, Fixed, Removed", () => {
    expect(byVersion("0.2.1").groups.map((g) => g.kind)).toEqual([
      "Added",
      "Changed",
      "Fixed",
      "Removed",
    ])
  })
})

// A changeset that writes a summary line followed by an indented bullet list,
// WITHOUT any `### Added/Fixed` kind headings (the 0.4.0 release shape). Each
// bullet must stay a separate item under the bump-type fallback kind, and the
// summary must become the version highlight — not get merged into one blob.
const SUMMARY_THEN_BULLETS = `# @knightcodeai/cli

## 0.4.0

### Minor Changes

- aa2645e: Harness reliability: safer edits and recovery from flaky model streams.

  - Session-scoped file-state ledger: a file must be read before it can be edited.
  - Edit tools collapse identical safe reads within a round.
  - Streaming recovery: transient stream failures retry with exponential backoff.
`

describe("parseChangelog (summary line + bullet list, no kind headings)", () => {
  const [entry] = parseChangelog(SUMMARY_THEN_BULLETS)
  const added = entry.groups.find((g) => g.kind === "Added")?.items ?? []

  it("keeps each bullet as a separate item under the fallback kind", () => {
    expect(added).toEqual([
      "Session-scoped file-state ledger: a file must be read before it can be edited.",
      "Edit tools collapse identical safe reads within a round.",
      "Streaming recovery: transient stream failures retry with exponential backoff.",
    ])
  })

  it("uses the summary line as the version highlight", () => {
    expect(entry.highlight).toBe(
      "Harness reliability: safer edits and recovery from flaky model streams.",
    )
  })

  it("does not merge the bullets into a single paragraph", () => {
    expect(added.length).toBe(3)
    for (const item of added) {
      expect(item).not.toContain(" Edit tools collapse")
    }
  })
})
