import fs from "fs"
import path from "path"

export type ChangeKind = "Added" | "Changed" | "Fixed"

export interface ChangelogEntry {
  version: string
  date?: string
  highlight?: string
  groups: { kind: ChangeKind; items: string[] }[]
}

const findChangelogPath = () => {
  const paths = [
    path.join(process.cwd(), "../../packages/cli/CHANGELOG.md"),
    path.join(process.cwd(), "packages/cli/CHANGELOG.md"),
    path.join(process.cwd(), "../packages/cli/CHANGELOG.md"),
  ]
  for (const p of paths) {
    if (fs.existsSync(p)) {
      return p
    }
  }
  throw new Error(`CHANGELOG.md not found in searched paths: ${paths.join(", ")}`)
}

export async function getChangelog(): Promise<ChangelogEntry[]> {
  let content = ""

  // Try fetching from GitHub raw URL first to support runtime updates on Vercel
  try {
    const res = await fetch("https://raw.githubusercontent.com/KnightCodeAI/knightcode/main/packages/cli/CHANGELOG.md", {
      next: { revalidate: 3600 }, // Cache for 1 hour
    })
    if (res.ok) {
      content = await res.text()
    } else {
      throw new Error(`Fetch failed with status ${res.status}`)
    }
  } catch (err) {
    console.warn("Failed to fetch changelog from GitHub, falling back to local file:", err)
    try {
      const changelogPath = findChangelogPath()
      content = fs.readFileSync(changelogPath, "utf-8")
    } catch (localErr) {
      console.error("Local changelog read failed:", localErr)
      return []
    }
  }
  
  const entries: ChangelogEntry[] = []
  const lines = content.split(/\r?\n/)
  
  let currentEntry: ChangelogEntry | null = null
  let currentGroup: { kind: ChangeKind; items: string[] } | null = null
  let currentItemText = ""
  
  const finalizeItem = () => {
    if (currentItemText && currentGroup) {
      // Clean commit hashes if any: e.g. "13af3df: Initial..." -> "Initial..."
      let cleaned = currentItemText.trim()
      const commitHashRegex = /^[a-f0-9]{7,8}:\s*/i
      cleaned = cleaned.replace(commitHashRegex, "")
      currentGroup.items.push(cleaned)
      currentItemText = ""
    }
  }
  
  const finalizeGroup = () => {
    finalizeItem()
    if (currentGroup && currentEntry) {
      if (currentGroup.items.length > 0) {
        currentEntry.groups.push(currentGroup)
      }
      currentGroup = null
    }
  }
  
  const finalizeEntry = () => {
    finalizeGroup()
    if (currentEntry) {
      if (currentEntry.groups.length > 0) {
        entries.push(currentEntry)
      }
      currentEntry = null
    }
  }
  
  for (const line of lines) {
    const trimmed = line.trim()
    
    if (line.startsWith("## ")) {
      finalizeEntry()
      const versionPart = line.slice(3).trim()
      // Parse version and date if available, e.g. "0.1.0 - 2026-06-10" or just "0.1.0"
      const dateMatch = versionPart.match(/(.*?)\s*-\s*(\d{4}-\d{2}-\d{2})/)
      let version = versionPart
      let date: string | undefined = undefined
      if (dateMatch) {
        version = dateMatch[1].trim()
        date = dateMatch[2]
      }
      currentEntry = {
        version,
        date,
        groups: []
      }
    } else if (line.startsWith("### ")) {
      finalizeGroup()
      const heading = line.slice(4).trim()
      let kind: ChangeKind = "Changed"
      if (heading.toLowerCase().includes("minor") || heading.toLowerCase().includes("add")) {
        kind = "Added"
      } else if (heading.toLowerCase().includes("patch") || heading.toLowerCase().includes("fix")) {
        kind = "Fixed"
      } else if (heading.toLowerCase().includes("major") || heading.toLowerCase().includes("change")) {
        kind = "Changed"
      }
      
      currentGroup = {
        kind,
        items: []
      }
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      finalizeItem()
      currentItemText = trimmed.slice(2)
    } else if (currentItemText && trimmed) {
      // Continuation of previous item
      currentItemText += " " + trimmed
    }
  }
  
  finalizeEntry()
  return entries
}
