export type ChangeKind = "Added" | "Changed" | "Fixed" | "Removed"

export interface ChangelogEntry {
  version: string
  date?: string
  highlight?: string
  groups: { kind: ChangeKind; items: string[] }[]
}

// Render order for the kind groups within a version.
const KIND_ORDER: ChangeKind[] = ["Added", "Changed", "Fixed", "Removed"]

// Map a section heading (e.g. "Added", "Bug Fixes") to a kind, or null if the
// heading isn't a kind (e.g. the "Patch Changes" / "Minor Changes" bump header
// changesets emits).
function mapKind(heading: string): ChangeKind | null {
  const h = heading.toLowerCase()
  if (h.startsWith("add")) return "Added"
  if (h.startsWith("chang")) return "Changed"
  if (h.startsWith("fix")) return "Fixed"
  if (h.startsWith("remov")) return "Removed"
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
export function parseChangelog(content: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = []
  const lines = content.split(/\r?\n/)

  // Current version entry being built.
  let entry: { version: string; date?: string; highlight?: string } | null = null
  let groupMap = new Map<ChangeKind, string[]>()

  // Current changeset state (reset on every top-level bullet).
  let bumpType: string | null = null
  let kind: ChangeKind | null = null // current kind section within the changeset
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
      finalizeChangeset()
      changesetIndex += 1
      changesetHasSection = false
      kind = null
      let rest = topBullet[1].replace(COMMIT_PREFIX, "")
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
        continue
      }
      const k = mapKind(text)
      if (k) {
        kind = k
        changesetHasSection = true
      }
      continue
    }

    // Blank line ends the current text block.
    if (!trimmed) {
      flushBuffer()
      continue
    }

    // Nested bullet (indented) — a section list item.
    const subBullet = raw.match(/^\s+[-*]\s+(.*)$/)
    if (subBullet) {
      flushBuffer()
      buffer = subBullet[1].trim()
      bufferKind = kind
      bufferIsLead = kind === null
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
      next: { revalidate: 1 },
    })
    if (res.ok) {
      content = await res.text()
    } else {
      throw new Error(`Fetch failed with status ${res.status}`)
    }
  } catch (err) {
    console.error("Failed to fetch changelog from GitHub:", err)
    return []
  }

  return parseChangelog(content)
}
