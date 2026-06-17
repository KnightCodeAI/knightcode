import { getChangelog } from "./changelog"
import { FALLBACK_VERSION } from "./site"

// Latest published version, derived from the top entry of the live changelog
// (the same fetch the changelog page uses, so the two never disagree).
// Server-only: pulls in the changelog parser (Node `fs`). Do not import from
// client components or edge routes — use FALLBACK_VERSION from site.ts there.
export async function getLatestVersion(): Promise<string> {
  try {
    const entries = await getChangelog()
    return entries[0]?.version ?? FALLBACK_VERSION
  } catch {
    return FALLBACK_VERSION
  }
}
