import {
  chooseLatestStable,
  CLI_PACKAGE,
  CLI_REPOSITORY,
  INSTALLER_LOCK_ASSET,
  lockDownloadUrl,
  parseInstallerVersion,
  STABLE_VERSION_RE,
  validateInstallerLock,
  versionFromReleaseTag,
} from "./installer-lock"
import lock0114 from "./installer-locks/0.11.4.json"

// Releases published before the GitHub Release carried installer-package-lock.json.
// A newer release is read from GitHub, so this map does not grow with each version.
const bundled = bundledLock(lock0114)
export const BUNDLED_INSTALLER_LOCKS: Record<string, unknown> = bundled
  ? { [bundled[0]]: bundled[1] }
  : {}

function bundledLock(lock: unknown): [string, unknown] | null {
  const version = (lock as { version?: unknown }).version
  if (typeof version !== "string" || validateInstallerLock(lock, version))
    return null
  return [version, lock]
}

type GithubRelease = {
  tag_name?: string
  draft?: boolean
  prerelease?: boolean
  assets?: { name?: string }[]
}

function githubHeaders(): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "knightcode-website",
    ...(process.env.GITHUB_TOKEN
      ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
      : {}),
  }
}

async function fetchNpmLatest(fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(`https://registry.npmjs.org/${CLI_PACKAGE}`, {
      headers: { Accept: "application/vnd.npm.install-v1+json" },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { "dist-tags"?: { latest?: string } }
    const version = data["dist-tags"]?.latest
    return version && STABLE_VERSION_RE.test(version) ? version : null
  } catch {
    return null
  }
}

export async function fetchGithubInstallerVersions(
  fetchImpl: typeof fetch
): Promise<string[] | null> {
  try {
    const res = await fetchImpl(
      `https://api.github.com/repos/${CLI_REPOSITORY}/releases?per_page=100`,
      { headers: githubHeaders() }
    )
    if (!res.ok) return null
    const releases = (await res.json()) as GithubRelease[]
    if (!Array.isArray(releases)) return null
    const versions: string[] = []
    for (const release of releases) {
      if (release.draft || release.prerelease) continue
      const version = versionFromReleaseTag(release.tag_name ?? "")
      if (!version || !STABLE_VERSION_RE.test(version)) continue
      if (
        !release.assets?.some((asset) => asset.name === INSTALLER_LOCK_ASSET)
      ) {
        continue
      }
      versions.push(version)
    }
    return versions
  } catch {
    return null
  }
}

export async function resolveLatestInstallerVersion(
  fetchImpl: typeof fetch = fetch
): Promise<string | null> {
  const [npmLatest, githubVersions] = await Promise.all([
    fetchNpmLatest(fetchImpl),
    fetchGithubInstallerVersions(fetchImpl),
  ])
  const available = new Set<string>(Object.keys(BUNDLED_INSTALLER_LOCKS))
  for (const version of githubVersions ?? []) available.add(version)
  if (
    npmLatest &&
    STABLE_VERSION_RE.test(npmLatest) &&
    available.has(npmLatest)
  ) {
    return npmLatest
  }
  return chooseLatestStable(available)
}

export async function loadInstallerLock(
  version: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; body: string } | { ok: false; status: 404 | 502 }> {
  const parsed = parseInstallerVersion(version)
  if (!parsed) return { ok: false, status: 404 }

  let remoteStatus: 404 | 502 = 404
  try {
    const res = await fetchImpl(lockDownloadUrl(parsed), {
      headers: {
        "User-Agent": "knightcode-website",
        Accept: "application/json",
      },
    })
    if (res.ok) {
      const text = await res.text()
      let lock: unknown
      try {
        lock = JSON.parse(text)
      } catch {
        remoteStatus = 502
        lock = null
      }
      if (lock && validateInstallerLock(lock, parsed) === null) {
        return { ok: true, body: text.endsWith("\n") ? text : `${text}\n` }
      }
      if (lock) remoteStatus = 502
    } else if (res.status !== 404) {
      remoteStatus = 502
    }
  } catch {
    remoteStatus = 502
  }

  const bundledLock = BUNDLED_INSTALLER_LOCKS[parsed]
  if (bundledLock && validateInstallerLock(bundledLock, parsed) === null) {
    return { ok: true, body: `${JSON.stringify(bundledLock, null, 2)}\n` }
  }
  return { ok: false, status: remoteStatus }
}
