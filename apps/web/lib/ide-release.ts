// The desktop IDE's update feed, read from the GitHub Releases of the IDE
// repository. crates/auto_update there asks for the newest release for its
// platform and installs the file only if its signature verifies against the
// key it was built with, so this feed picks files and never vouches for them.

export const IDE_REPOSITORY = "KnightCodeAI/knightcode-ide"

// What .github/workflows/knightcode-release.yml in the IDE repository publishes
// for each platform, keyed the way the IDE reports its platform: Rust's
// std::env::consts::OS and ARCH.
const INSTALLERS: Record<string, string> = {
  "windows-x86_64": "KnightCode-x86_64.exe",
  "macos-aarch64": "KnightCode-aarch64.dmg",
  "macos-x86_64": "KnightCode-x86_64.dmg",
  "linux-x86_64": "knightcode-linux-x86_64.tar.gz",
  "linux-aarch64": "knightcode-linux-aarch64.tar.gz",
}

export function installerName(
  os: string | null,
  arch: string | null
): string | null {
  return INSTALLERS[`${os}-${arch}`] ?? null
}

export type GithubRelease = {
  tag_name: string
  draft: boolean
  prerelease: boolean
  assets: { name: string; browser_download_url: string }[]
}

export type ReleaseFiles = {
  version: string
  url: string
  signatureUrl: string
}

// The installer and its detached signature from a published release, or null
// when the release is not one to offer or lacks either file.
export function pickInstaller(
  release: GithubRelease,
  name: string
): ReleaseFiles | null {
  if (release.draft || release.prerelease) return null
  const download = (file: string) =>
    release.assets.find((asset) => asset.name === file)?.browser_download_url
  const url = download(name)
  const signatureUrl = download(`${name}.sig`)
  if (!url || !signatureUrl) return null
  return { version: release.tag_name.replace(/^v/, ""), url, signatureUrl }
}
