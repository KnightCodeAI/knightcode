// Contract shared by public/install.sh and `knightcode update`.
// install.sh rejects a package.json or lockfile that fails these checks, so a
// lock is only published after it passes the same checks.

export const CLI_PACKAGE = "@knightcodeai/cli"
export const INSTALLER_PACKAGE_NAME = "knightcode-managed-install"
export const INSTALLER_LOCK_ASSET = "installer-package-lock.json"
export const CLI_REPOSITORY = "KnightCodeAI/knightcode"

// Same shape package-manager-cli.ts accepts for a managed release version.
export const INSTALLER_VERSION_RE =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
export const STABLE_VERSION_RE = /^\d+\.\d+\.\d+$/

export const PLATFORM_PACKAGES = [
  "@knightcodeai/cli-linux-x64",
  "@knightcodeai/cli-linux-arm64",
  "@knightcodeai/cli-darwin-x64",
  "@knightcodeai/cli-darwin-arm64",
  "@knightcodeai/cli-win32-x64",
] as const

export type InstallerPackageJson = {
  name: typeof INSTALLER_PACKAGE_NAME
  version: string
  private: true
  description: string
  dependencies: Record<string, string>
}

type LockRoot = {
  version?: unknown
  dependencies?: Record<string, unknown>
}

type LockFile = {
  lockfileVersion?: unknown
  version?: unknown
  packages?: Record<string, { version?: unknown } | undefined>
}

export function parseInstallerVersion(value: string): string | null {
  return INSTALLER_VERSION_RE.test(value) ? value : null
}

export function installerPackageJson(version: string): InstallerPackageJson {
  return {
    name: INSTALLER_PACKAGE_NAME,
    version,
    private: true,
    description: "Lockfile root used by the KnightCode installer and updater.",
    dependencies: { [CLI_PACKAGE]: version },
  }
}

// Mirrors validate_managed_install_artifacts in public/install.sh.
export function validateInstallerPackageJson(
  manifest: unknown,
  version: string
): string | null {
  if (!manifest || typeof manifest !== "object") {
    return "package.json is not an object"
  }
  const file = manifest as {
    version?: unknown
    dependencies?: Record<string, unknown>
  }
  if (
    file.version !== version ||
    file.dependencies?.[CLI_PACKAGE] !== version
  ) {
    return `package.json must describe ${CLI_PACKAGE}@${version}`
  }
  return null
}

// Mirrors validate_managed_install_artifacts in public/install.sh.
export function validateInstallerLock(
  lock: unknown,
  version: string
): string | null {
  if (!lock || typeof lock !== "object") return "lockfile is not an object"
  const file = lock as LockFile
  const root = file.packages?.[""] as LockRoot | undefined
  const cli = file.packages?.[`node_modules/${CLI_PACKAGE}`]
  if (file.lockfileVersion !== 3) return "lockfileVersion must be 3"
  if (
    file.version !== version ||
    root?.version !== version ||
    root?.dependencies?.[CLI_PACKAGE] !== version
  ) {
    return `lockfile root must describe ${CLI_PACKAGE}@${version}`
  }
  if (cli?.version !== version) {
    return `lockfile does not include ${CLI_PACKAGE}@${version}`
  }
  return null
}

// npm ci installs only the optional dependencies recorded in the lock. A lock
// made on one OS still has to name every platform binary.
export function missingPlatformPackages(lock: unknown): string[] {
  const packages = (lock as LockFile).packages ?? {}
  return PLATFORM_PACKAGES.filter(
    (name) => packages[`node_modules/${name}`] === undefined
  )
}

export function lockDownloadUrl(version: string): string {
  // GitHub keeps the slash in @knightcodeai/cli@<version> and encodes each @.
  const encoded = encodeURIComponent(version)
  return `https://github.com/${CLI_REPOSITORY}/releases/download/%40knightcodeai/cli%40${encoded}/${INSTALLER_LOCK_ASSET}`
}

export function versionFromReleaseTag(tag: string): string | null {
  const prefix = `${CLI_PACKAGE}@`
  if (!tag.startsWith(prefix)) return null
  return parseInstallerVersion(tag.slice(prefix.length))
}

export function compareStable(left: string, right: string): number {
  const a = left.split(".").map(Number)
  const b = right.split(".").map(Number)
  for (let i = 0; i < 3; i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

export function chooseLatestStable(versions: Iterable<string>): string | null {
  let best: string | null = null
  for (const version of versions) {
    if (!STABLE_VERSION_RE.test(version)) continue
    if (!best || compareStable(version, best) > 0) best = version
  }
  return best
}
