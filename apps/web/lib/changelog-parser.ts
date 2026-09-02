import { CHANGELOG_FALLBACK } from "./changelog-fallback"

export type ChangeKind =
  | "Added"
  | "Changed"
  | "Deprecated"
  | "Removed"
  | "Fixed"
  | "Security"

export interface ChangelogEntry {
  version: string
  date?: string
  highlight?: string
  groups: { kind: ChangeKind; items: string[] }[]
}

// Render order for the kind groups within a version: Keep a Changelog's order,
// the same order scripts/changelog-sections.ts writes the headings in, so a
// release reads the same way on the site as in the file.
const KIND_ORDER: ChangeKind[] = [
  "Added",
  "Changed",
  "Deprecated",
  "Removed",
  "Fixed",
  "Security",
]

// Map a section heading (e.g. "Added", "Bug Fixes") to a kind, or null if the
// heading isn't a kind (e.g. the "Patch Changes" / "Minor Changes" bump header
// changesets emits).
function mapKind(heading: string): ChangeKind | null {
  const h = heading.toLowerCase()
  if (h.startsWith("add")) return "Added"
  if (h.startsWith("chang")) return "Changed"
  if (h.startsWith("deprecat")) return "Deprecated"
  if (h.startsWith("remov")) return "Removed"
  if (h.startsWith("fix")) return "Fixed"
  if (h.startsWith("securit")) return "Security"
  return null
}

// Where to file a changeset that has no explicit kind sections, based on the
// changesets bump header it lives under.
function fallbackKind(bumpType: string | null): ChangeKind {
  if (bumpType === "minor") return "Added"
  if (bumpType === "major") return "Changed"
  return "Fixed" // patch (and unknown) default
}

const COMMIT_PREFIX = /^[0-9a-f]{7,40}:\s*/i

// Parse a changesets-generated CHANGELOG.md into version entries with their
// changes grouped by kind. The format looks like:
//
//   ## 0.2.1
//   ### Patch Changes              <- bump header (not a kind)
//   - b529674: ### Added           <- changeset bullet, kind may be glued on
//     Memory follow-ups: ...       <- paragraph content
//     ### Fixed                    <- nested kind section
//     `Tab` mode cycle ...
//   - 23a8811: Refresh the catalog  <- changeset with a lead summary
//     ### Added
//     - bullet list items ...      <- sections may also use bullet lists
//
// Rules: bump headers are ignored for grouping; a changeset's content is filed
// under its nested kind sections; the first changeset's lead summary (text
// before its first kind section) becomes the version highlight; a changeset
// with no kind sections is bucketed under the bump-type's fallback kind.
//
// Since scripts/changelog-sections.ts, the release regroups the newest section
// under Keep a Changelog headings, so the top of the file instead looks like:
//
//   ## 0.5.4
//   ### Added                      <- kind heading at column 0
//   - Added a flag.                <- one item, not a changeset
//   ### Fixed
//   - Fixed a thing.
//
// The two shapes are told apart by indentation: a kind heading at column 0 owns
// the bullets under it, whereas the old shape's kind headings are indented
// inside a changeset whose column-0 bullets are changeset boundaries. Only the
// newest section is ever regrouped, so every older one keeps the old shape and
// both paths have to keep working.
export function parseChangelog(content: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = []
  const lines = content.split(/\r?\n/)

  // Current version entry being built.
  let entry: { version: string; date?: string; highlight?: string } | null = null
  let groupMap = new Map<ChangeKind, string[]>()

  // Current changeset state (reset on every top-level bullet).
  let bumpType: string | null = null
  let kind: ChangeKind | null = null // current kind section within the changeset
  // Set when a kind heading sits at column 0 (the regrouped shape). While it is
  // set, a column-0 bullet is an item under it rather than a new changeset.
  let sectionKind: ChangeKind | null = null
  let changesetIndex = -1 // 0-based index of the changeset within this version
  let changesetHasSection = false // has the current changeset hit a kind heading?
  let lead = "" // accumulated text before the changeset's first kind section

  // Current text block (paragraph or bullet, with wrapped-line continuation).
  let buffer = ""
  let bufferKind: ChangeKind | null = null
  let bufferIsLead = false

  const pushItem = (k: ChangeKind, text: string) => {
    const existing = groupMap.get(k)
    if (existing) existing.push(text)
    else groupMap.set(k, [text])
  }

  // Commit the current text block to the right place.
  const flushBuffer = () => {
    const text = buffer.trim()
    buffer = ""
    const wasLead = bufferIsLead
    bufferIsLead = false
    if (!text || !entry) return
    if (wasLead) lead += lead ? ` ${text}` : text
    else if (bufferKind) pushItem(bufferKind, text)
  }

  // Finalize the changeset that just ended: a lead with no kind sections becomes
  // an item under the fallback kind; a first-changeset lead that DID have
  // sections becomes the version highlight.
  const finalizeChangeset = () => {
    flushBuffer()
    if (!entry || !lead) {
      lead = ""
      return
    }
    if (!changesetHasSection) {
      pushItem(fallbackKind(bumpType), lead)
    } else if (changesetIndex === 0 && !entry.highlight) {
      entry.highlight = lead
    }
    lead = ""
  }

  const finalizeEntry = () => {
    finalizeChangeset()
    if (!entry) return
    const groups = KIND_ORDER.filter((k) => groupMap.get(k)?.length).map((k) => ({
      kind: k,
      items: groupMap.get(k)!,
    }))
    if (groups.length > 0 || entry.highlight) {
      entries.push({ ...entry, groups })
    }
    entry = null
    groupMap = new Map()
  }

  for (const raw of lines) {
    const trimmed = raw.trim()

    // Version heading: "## 0.2.1" or "## 0.2.1 - 2026-06-10".
    if (/^## /.test(trimmed)) {
      finalizeEntry()
      const versionPart = trimmed.slice(3).trim()
      const dateMatch = versionPart.match(/(.*?)\s*-\s*(\d{4}-\d{2}-\d{2})/)
      entry = dateMatch
        ? { version: dateMatch[1].trim(), date: dateMatch[2] }
        : { version: versionPart }
      bumpType = null
      kind = null
      sectionKind = null
      changesetIndex = -1
      changesetHasSection = false
      lead = ""
      buffer = ""
      bufferKind = null
      bufferIsLead = false
      continue
    }

    if (!entry) continue

    // Top-level changeset bullet (column 0, no leading whitespace).
    const topBullet = raw.match(/^[-*]\s+(.*)$/)
    if (topBullet) {
      // Regrouped shape: the column-0 kind heading above owns this bullet, so
      // it is one item. Treating it as a changeset boundary instead would drop
      // the heading and file everything under the bump-type fallback.
      if (sectionKind) {
        flushBuffer()
        buffer = topBullet[1].replace(COMMIT_PREFIX, "").trim()
        bufferKind = sectionKind
        bufferIsLead = false
        continue
      }
      finalizeChangeset()
      changesetIndex += 1
      changesetHasSection = false
      kind = null
      const rest = topBullet[1].replace(COMMIT_PREFIX, "")
      // A kind heading can be glued onto the bullet: "- b529674: ### Added".
      const gluedHeading = rest.match(/^#{2,4}\s+(.*)$/)
      if (gluedHeading) {
        const k = mapKind(gluedHeading[1].trim())
        if (k) {
          kind = k
          changesetHasSection = true
        }
        continue
      }
      if (rest) {
        // Lead summary text for this changeset (before any kind section).
        buffer = rest
        bufferKind = null
        bufferIsLead = true
      }
      continue
    }

    // Heading line: either a bump header or a nested kind section.
    const heading = trimmed.match(/^#{2,4}\s+(.*)$/)
    if (heading) {
      flushBuffer()
      const text = heading[1].trim()
      if (/\b(patch|minor|major)\b/i.test(text) && /change/i.test(text)) {
        bumpType = text.toLowerCase().match(/patch|minor|major/)?.[0] ?? null
        kind = null
        sectionKind = null
        continue
      }
      const k = mapKind(text)
      if (k) {
        kind = k
        changesetHasSection = true
        // Column 0 means the regrouped shape; an indented heading is the old
        // one, nested inside a changeset.
        sectionKind = raw.startsWith("#") ? k : null
      }
      continue
    }

    // Blank line ends the current text block.
    if (!trimmed) {
      flushBuffer()
      continue
    }

    // Nested bullet (indented) — always a discrete list item, never lead text.
    const subBullet = raw.match(/^\s+[-*]\s+(.*)$/)
    if (subBullet) {
      flushBuffer()
      buffer = subBullet[1].trim()
      // When the changeset has no explicit "### Kind" heading, a bulleted list
      // still describes real changes: file each bullet under the bump-type
      // fallback kind and treat the preceding summary as a section, so the
      // leading text becomes the version highlight instead of swallowing the
      // bullets into one merged paragraph.
      if (kind === null) {
        bufferKind = fallbackKind(bumpType)
        changesetHasSection = true
      } else {
        bufferKind = kind
      }
      bufferIsLead = false
      continue
    }

    // Otherwise: paragraph text, or a wrapped continuation of the current block.
    if (buffer) {
      buffer += ` ${trimmed}`
    } else {
      buffer = trimmed
      bufferKind = kind
      bufferIsLead = kind === null
    }
  }

  finalizeEntry()
  return entries
}

export async function getChangelog(): Promise<ChangelogEntry[]> {
  let content = ""

  try {
    const res = await fetch("https://raw.githubusercontent.com/KnightCodeAI/knightcode/main/packages/cli/CHANGELOG.md", {
      // Always read the live changelog so the version badge and release notes
      // reflect GitHub `main` immediately after a release. `no-store` opts every
      // page that calls this (home, footer, changelog) into dynamic rendering,
      // so there is no stale ISR snapshot to serve. GitHub's raw CDN still
      // shields us from per-request load.
      cache: "no-store",
    })
    if (res.ok) {
      content = await res.text()
    } else {
      throw new Error(`Fetch failed with status ${res.status}`)
    }
  } catch (err) {
    // GitHub unreachable: fall back to the build-time snapshot so the page
    // still renders entries instead of going empty.
    console.error("Failed to fetch changelog from GitHub, using bundled fallback:", err)
    content = CHANGELOG_FALLBACK
  }

  try {
    return parseChangelog(content)
  } catch (err) {
    // A malformed changelog must not crash the page render; degrade to empty
    // and let callers fall back (npm registry / build-time version).
    console.error("Failed to parse changelog:", err)
    return []
  }
}
