import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "bun:test"

import {
  chooseLatestStable,
  CLI_PACKAGE,
  INSTALLER_LOCK_ASSET,
  lockDownloadUrl,
  missingPlatformPackages,
  PLATFORM_PACKAGES,
  validateInstallerLock,
  versionFromReleaseTag,
} from "./installer-lock"
import {
  BUNDLED_INSTALLER_LOCKS,
  fetchGithubInstallerVersions,
  loadInstallerLock,
  resolveLatestInstallerVersion,
} from "./installer-release"
import { GET as getArtifact } from "../app/api/installer/releases/[version]/[artifact]/route"
import { GET as getLatest } from "../app/api/installer/releases/latest/route"

const installScript = readFileSync(
  join(import.meta.dir, "../public/install.sh"),
  "utf8"
)

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function requestUrl(input: string | URL | Request): string {
  return typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : input.url
}

function lockFor(version: string) {
  return {
    lockfileVersion: 3,
    version,
    packages: {
      "": { version, dependencies: { [CLI_PACKAGE]: version } },
      [`node_modules/${CLI_PACKAGE}`]: { version },
      ...Object.fromEntries(
        PLATFORM_PACKAGES.map((name) => [`node_modules/${name}`, { version }])
      ),
    },
  }
}

// npm says 0.12.0 is latest and its GitHub Release carries a lock asset.
function releaseFetch(lock: unknown): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = requestUrl(input)
    if (url.includes("registry.npmjs.org")) {
      return jsonResponse({ "dist-tags": { latest: "0.12.0" } })
    }
    if (url === lockDownloadUrl("0.12.0")) return jsonResponse(lock)
    if (url.includes("api.github.com")) {
      return jsonResponse([
        {
          tag_name: "@knightcodeai/cli@0.12.0",
          assets: [{ name: INSTALLER_LOCK_ASSET }],
        },
      ])
    }
    return jsonResponse(null, 404)
  }) as typeof fetch
}

describe("installer lock contract", () => {
  it("accepts the bundled lock and every platform binary", () => {
    const version = "0.11.4"
    const lock = BUNDLED_INSTALLER_LOCKS[version]
    expect(validateInstallerLock(lock, version)).toBeNull()
    expect(missingPlatformPackages(lock)).toEqual([])
  })

  it("rejects a lock that install.sh would reject", () => {
    expect(validateInstallerLock({ lockfileVersion: 2 }, "0.11.4")).toBe(
      "lockfileVersion must be 3"
    )
  })

  it("keeps the same checks the shell script runs", () => {
    expect(installScript).toContain(
      'marker.kind !== "knightcode-managed-install"'
    )
    expect(installScript).toContain(
      "https://knightcode.dev/api/installer/releases"
    )
    expect(installScript).toContain(CLI_PACKAGE)
    expect(installScript).toContain("lockfileVersion !== 3")
    expect(installScript).toContain("KNIGHTCODE_MANAGED_INSTALL_ROOT")
    expect(installScript).not.toContain("pi.dev")
    expect(installScript).not.toContain("earendil")
  })
})

describe("installer release selection", () => {
  it("parses CLI release tags and ignores other tags", () => {
    expect(versionFromReleaseTag("@knightcodeai/cli@0.11.4")).toBe("0.11.4")
    expect(versionFromReleaseTag("v0.11.4")).toBeNull()
    expect(versionFromReleaseTag("@knightcodeai/cli@not-a-version")).toBeNull()
  })

  it("picks the highest stable version", () => {
    expect(
      chooseLatestStable(["0.9.0", "0.11.4", "0.11.3", "1.0.0-beta.1"])
    ).toBe("0.11.4")
  })

  it("builds the GitHub download URL with the tag slash intact", () => {
    expect(lockDownloadUrl("0.11.4")).toBe(
      "https://github.com/KnightCodeAI/knightcode/releases/download/%40knightcodeai/cli%400.11.4/installer-package-lock.json"
    )
  })

  it("lists only stable releases that carry the installer lock", async () => {
    const fetchImpl = (async () =>
      jsonResponse([
        {
          tag_name: "@knightcodeai/cli@0.11.4",
          assets: [{ name: INSTALLER_LOCK_ASSET }],
        },
        {
          tag_name: "@knightcodeai/cli@0.12.0-beta.1",
          assets: [{ name: INSTALLER_LOCK_ASSET }],
        },
        {
          tag_name: "@knightcodeai/cli@0.11.3",
          assets: [{ name: "knightcode-linux-x64.tar.gz" }],
        },
        {
          tag_name: "v1.0.0",
          draft: true,
          assets: [{ name: INSTALLER_LOCK_ASSET }],
        },
      ])) as typeof fetch

    expect(await fetchGithubInstallerVersions(fetchImpl)).toEqual(["0.11.4"])
  })

  it("offers the npm latest version when its lock exists", async () => {
    expect(
      await resolveLatestInstallerVersion(releaseFetch(lockFor("0.12.0")))
    ).toBe("0.12.0")
  })

  it("skips a release whose attached lock is invalid", async () => {
    const wrongVersion = lockFor("0.11.0")
    const { [`node_modules/${PLATFORM_PACKAGES[0]}`]: _, ...partial } =
      lockFor("0.12.0").packages
    const missingPlatform = { ...lockFor("0.12.0"), packages: partial }
    for (const lock of [wrongVersion, missingPlatform, "not json"]) {
      expect(await resolveLatestInstallerVersion(releaseFetch(lock))).toBe(
        "0.11.4"
      )
    }
  })

  it("stays on the previous lock while a new release is still uploading", async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = requestUrl(input)
      if (url.includes("registry.npmjs.org")) {
        return jsonResponse({ "dist-tags": { latest: "0.12.0" } })
      }
      return jsonResponse([
        {
          tag_name: "@knightcodeai/cli@0.11.4",
          assets: [{ name: INSTALLER_LOCK_ASSET }],
        },
      ])
    }) as typeof fetch

    expect(await resolveLatestInstallerVersion(fetchImpl)).toBe("0.11.4")
  })
})

describe("installer routes", () => {
  it("serves the bundled lock when GitHub has no asset yet", async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response("missing", { status: 404 })) as typeof fetch
    try {
      const response = await getArtifact(new Request("http://localhost"), {
        params: Promise.resolve({
          version: "0.11.4",
          artifact: "package-lock.json",
        }),
      })
      expect(response.status).toBe(200)
      const lock = await response.json()
      expect(validateInstallerLock(lock, "0.11.4")).toBeNull()
    } finally {
      globalThis.fetch = original
    }
  })

  it("serves package.json only for a version whose lock exists", async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response("missing", { status: 404 })) as typeof fetch
    try {
      const found = await getArtifact(new Request("http://localhost"), {
        params: Promise.resolve({
          version: "0.11.4",
          artifact: "package.json",
        }),
      })
      expect(found.status).toBe(200)
      expect(await found.json()).toMatchObject({
        dependencies: { [CLI_PACKAGE]: "0.11.4" },
      })

      const missing = await getArtifact(new Request("http://localhost"), {
        params: Promise.resolve({ version: "9.9.9", artifact: "package.json" }),
      })
      expect(missing.status).toBe(404)

      const invalid = await getArtifact(new Request("http://localhost"), {
        params: Promise.resolve({ version: "../x", artifact: "package.json" }),
      })
      expect(invalid.status).toBe(404)
    } finally {
      globalThis.fetch = original
    }
  })

  it("reports the bundled version when the registry and GitHub are silent", async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(null, { status: 502 })) as typeof fetch
    try {
      const response = await getLatest()
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        schemaVersion: 1,
        version: "0.11.4",
      })
    } finally {
      globalThis.fetch = original
    }
  })

  it("uses a remote lock instead of the bundled copy", async () => {
    const body = await loadInstallerLock("0.11.4", (async () =>
      jsonResponse(lockFor("0.11.4"))) as typeof fetch)
    expect(body.ok).toBe(true)
    if (body.ok) expect(JSON.parse(body.body).packages[""].name).toBeUndefined()
  })
})
