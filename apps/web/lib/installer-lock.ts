// Contract shared by public/install.sh and `knightcode update`.
// install.sh rejects a package.json or lockfile that fails these checks, so a
// lock is only published after it passes the same checks.

export const CLI_PACKAGE = "knightcode"
// The npm name before the rename. Locks for releases published under it keep
// it, and release tags still carry it so older binaries find their updates.
export const LEGACY_CLI_PACKAGE = "@knightcodeai/cli"
export const INSTALLER_PACKAGE_NAME = "knightcode-managed-install"
export const INSTALLER_LOCK_ASSET = "installer-package-lock.json"
export const CLI_REPOSITORY = "KnightCodeAI/knightcode"

// Same shape package-manager-cli.ts accepts for a managed release version.
export const INSTALLER_VERSION_RE =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
export const STABLE_VERSION_RE = /^\d+\.\d+\.\d+$/

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

export function installerPackageJson(
  version: string,
  cliPackage: string = CLI_PACKAGE
): InstallerPackageJson {
  return {
    name: INSTALLER_PACKAGE_NAME,
    version,
    private: true,
    description: "Lockfile root used by the KnightCode installer and updater.",
    dependencies: { [cliPackage]: version },
  }
}

// The CLI package a lock installs: the current name, or the legacy one for
// releases published before the rename.
export function lockCliPackage(lock: unknown): string {
  const root = (lock as LockFile | null)?.packages?.[""] as LockRoot | undefined
  return root?.dependencies?.[LEGACY_CLI_PACKAGE] === undefined
    ? CLI_PACKAGE
    : LEGACY_CLI_PACKAGE
}

// Mirrors validate_managed_install_artifacts in public/install.sh.
export function validateInstallerLock(
  lock: unknown,
  version: string
): string | null {
  if (!lock || typeof lock !== "object") return "lockfile is not an object"
  const file = lock as LockFile
  const cliPackage = lockCliPackage(lock)
  const root = file.packages?.[""] as LockRoot | undefined
  const cli = file.packages?.[`node_modules/${cliPackage}`]
  if (file.lockfileVersion !== 3) return "lockfileVersion must be 3"
  if (
    file.version !== version ||
    root?.version !== version ||
    root?.dependencies?.[cliPackage] !== version
  ) {
    return `lockfile root must describe ${cliPackage}@${version}`
  }
  if (cli?.version !== version) {
    return `lockfile does not include ${cliPackage}@${version}`
  }
  return null
}

export function lockDownloadUrl(version: string): string {
  // GitHub keeps the slash in @knightcodeai/cli@<version> and encodes each @.
  const encoded = encodeURIComponent(version)
  return `https://github.com/${CLI_REPOSITORY}/releases/download/%40knightcodeai/cli%40${encoded}/${INSTALLER_LOCK_ASSET}`
}

export function versionFromReleaseTag(tag: string): string | null {
  const prefix = `${LEGACY_CLI_PACKAGE}@`
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
