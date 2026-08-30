import { getChangelog } from "./changelog"
import { FALLBACK_VERSION, NPM_PACKAGE } from "./site"

// Latest published version from the npm registry. Used as a live fallback when
// the GitHub changelog fetch is unavailable, so we still report the real latest
// version instead of the build-time one. Returns null on any failure.
export async function getNpmLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${NPM_PACKAGE}`, {
      headers: { Accept: "application/vnd.npm.install-v1+json" },
      cache: "no-store",
    })
    if (!res.ok) return null
    const data = (await res.json()) as { "dist-tags"?: { latest?: string } }
    return data["dist-tags"]?.latest ?? null
  } catch {
    return null
  }
}

// Latest published version. Prefers the top of the live changelog (so it agrees
// with the entries shown on the page), then the npm registry, then the
// build-time version baked in at deploy.
export async function getLatestVersion(): Promise<string> {
  try {
    const entries = await getChangelog()
    if (entries[0]?.version) return entries[0].version
  } catch (err) {
    console.error("Failed to resolve version from changelog:", err)
  }
  return (await getNpmLatestVersion()) ?? FALLBACK_VERSION
}
