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

// The five targets the release workflow builds, in the order the download page
// lists them. `label` is what a person reading the page recognises; `warning`
// is the one they will actually hit, because none of these is signed.
export const PLATFORMS = [
  {
    key: "windows-x86_64",
    os: "Windows",
    arch: "Intel / AMD 64-bit",
    file: INSTALLERS["windows-x86_64"],
    instructions:
      "Run the installer. Windows SmartScreen will say “Windows protected your PC”, because the installer is not signed with a Microsoft-recognised certificate. Choose More info, then Run anyway.",
  },
  {
    key: "macos-aarch64",
    os: "macOS",
    arch: "Apple silicon",
    file: INSTALLERS["macos-aarch64"],
    instructions:
      "Open the .dmg and drag KnightCode to Applications. The first launch is refused: the app is not notarised. Open System Settings → Privacy & Security, find the blocked-app notice, and choose Open Anyway. Or run xattr -dr com.apple.quarantine /Applications/KnightCode.app once.",
  },
  {
    key: "macos-x86_64",
    os: "macOS",
    arch: "Intel",
    file: INSTALLERS["macos-x86_64"],
    instructions:
      "Open the .dmg and drag KnightCode to Applications. The first launch is refused: the app is not notarised. Open System Settings → Privacy & Security, find the blocked-app notice, and choose Open Anyway. Or run xattr -dr com.apple.quarantine /Applications/KnightCode.app once.",
  },
  {
    key: "linux-x86_64",
    os: "Linux",
    arch: "Intel / AMD 64-bit",
    file: INSTALLERS["linux-x86_64"],
    instructions:
      "Extract the archive and run ./knightcode.app/bin/knightcode-ide, or install it for your user with ./knightcode.app/bin/knightcode-ide --install. No signature check is involved; verify the download against the .sig file if you want one.",
  },
  {
    key: "linux-aarch64",
    os: "Linux",
    arch: "ARM 64-bit",
    file: INSTALLERS["linux-aarch64"],
    instructions:
      "Extract the archive and run ./knightcode.app/bin/knightcode-ide, or install it for your user with ./knightcode.app/bin/knightcode-ide --install. No signature check is involved; verify the download against the .sig file if you want one.",
  },
] as const

export type Platform = (typeof PLATFORMS)[number]

// The builds to put first for a visitor, from what their browser says about
// itself; none for a phone or tablet. `architecture` is the Client Hint
// ("arm" or "x86"), which only Chromium sends, and only to the browser, not
// with the first request. Without it a Mac's chip is unknowable: every Mac
// browser says "Intel Mac OS X", Apple silicon included, so both Mac builds
// come first rather than one that half of them cannot run. Chrome calls every
// Linux x86_64, which is the likelier of the two.
export function guessPlatform({
  userAgent,
  architecture,
  mobile = false,
}: {
  userAgent: string
  architecture?: string
  mobile?: boolean
}): Platform["key"][] {
  const ua = userAgent.toLowerCase()
  if (mobile || /android|iphone|ipad|ipod|mobile/.test(ua)) return []
  const hinted =
    architecture === "arm"
      ? "aarch64"
      : architecture === "x86"
        ? "x86_64"
        : null
  // Only an x64 build exists; Windows on ARM runs it under emulation.
  if (ua.includes("windows")) return ["windows-x86_64"]
  if (ua.includes("macintosh") || ua.includes("mac os x"))
    return hinted ? [`macos-${hinted}`] : ["macos-aarch64", "macos-x86_64"]
  if (ua.includes("linux") || ua.includes("x11"))
    return [
      `linux-${hinted ?? (/aarch64|arm64/.test(ua) ? "aarch64" : "x86_64")}`,
    ]
  return []
}

// Every platform's installer in one published release, with the ones that
// release does not carry left out rather than linked to a 404.
export function installersFor(
  release: GithubRelease
): { platform: Platform; files: ReleaseFiles }[] {
  return PLATFORMS.flatMap((platform) => {
    const files = pickInstaller(release, platform.file)
    return files ? [{ platform, files }] : []
  })
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
