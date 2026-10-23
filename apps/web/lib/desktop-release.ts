import {
  CLI_REPOSITORY,
  compareStable,
  STABLE_VERSION_RE,
} from "./installer-lock"

// The desktop app's update feed (apps/desktop/src/main/updates.ts), read from
// the GitHub Releases of this repository tagged desktop-v<version>, which
// .github/workflows/desktop-release.yml drafts and the owner publishes. Only
// published releases are offered, the newest by version.

export const DESKTOP_TAG_PREFIX = "desktop-v"
export const DESKTOP_RELEASE_REVALIDATE_SECONDS = 300

export type DesktopRelease = {
  tag_name: string
  draft: boolean
  prerelease: boolean
  html_url: string
  body?: string | null
  published_at?: string | null
  assets: { name: string; browser_download_url: string }[]
}

export type LatestDesktopRelease = { release: DesktopRelease; version: string }

export function desktopVersion(tag: string): string | null {
  if (!tag.startsWith(DESKTOP_TAG_PREFIX)) return null
  const version = tag.slice(DESKTOP_TAG_PREFIX.length)
  return STABLE_VERSION_RE.test(version) ? version : null
}

export function latestDesktopRelease(
  releases: DesktopRelease[]
): LatestDesktopRelease | null {
  let latest: LatestDesktopRelease | null = null
  for (const release of releases) {
    if (release.draft || release.prerelease) continue
    const version = desktopVersion(release.tag_name)
    if (!version) continue
    if (!latest || compareStable(version, latest.version) > 0)
      latest = { release, version }
  }
  return latest
}

// Squirrel.Windows reads RELEASES, one "<sha1> <file> <size>" line per
// package, with the files named relative to the feed. Answered with the
// release's download URLs in their place, which Squirrel also accepts; a line
// naming a file the release does not carry is dropped.
export function squirrelReleases(
  text: string,
  release: DesktopRelease
): string {
  const urls = new Map(
    release.assets.map((asset) => [asset.name, asset.browser_download_url])
  )
  return text
    .split(/\r?\n/)
    .flatMap((line) => {
      const [sha1, file, size, ...rest] = line.trim().split(/\s+/)
      const url = file && urls.get(file)
      return sha1 && url && size && rest.length === 0
        ? [`${sha1} ${url} ${size}`]
        : []
    })
    .join("\n")
}

// macOS: the newer release for an app at `current`, if it carries a build for
// `arch` (Forge's zip, KnightCode-darwin-<arch>-<version>.zip, or its dmg,
// KnightCode-<version>-<arch>.dmg); null when there is nothing to offer.
export function macUpdate(
  latest: LatestDesktopRelease,
  current: string,
  arch: string
): { version: string; url: string; notes: string; pub_date: string } | null {
  if (!STABLE_VERSION_RE.test(current)) return null
  if (compareStable(latest.version, current) <= 0) return null
  const built = latest.release.assets.some(
    ({ name }) =>
      name.includes(`darwin-${arch}-`) || name.endsWith(`-${arch}.dmg`)
  )
  if (!built) return null
  return {
    version: latest.version,
    url: latest.release.html_url,
    notes: latest.release.body ?? "",
    pub_date: latest.release.published_at ?? "",
  }
}

export async function fetchDesktopReleases(
  fetchImpl: typeof fetch = fetch
): Promise<DesktopRelease[] | null> {
  try {
    const res = await fetchImpl(
      `https://api.github.com/repos/${CLI_REPOSITORY}/releases?per_page=100`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "knightcode-website",
          ...(process.env.GITHUB_TOKEN
            ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
            : {}),
        },
        next: { revalidate: DESKTOP_RELEASE_REVALIDATE_SECONDS },
      }
    )
    if (!res.ok) return null
    const releases = (await res.json()) as unknown
    return Array.isArray(releases) ? (releases as DesktopRelease[]) : null
  } catch {
    return null
  }
}
