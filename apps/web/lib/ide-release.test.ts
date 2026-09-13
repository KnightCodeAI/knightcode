import { describe, expect, it } from "bun:test"

import { type GithubRelease, installerName, pickInstaller } from "./ide-release"

const download = (tag: string, name: string) =>
  `https://github.com/KnightCodeAI/knightcode-ide/releases/download/${tag}/${name}`

function release(overrides: Partial<GithubRelease> = {}): GithubRelease {
  const tag = overrides.tag_name ?? "v0.2.0"
  const names = [
    "KnightCode-x86_64.exe",
    "KnightCode-x86_64.exe.sig",
    "knightcode-linux-x86_64.tar.gz",
  ]
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    assets: names.map((name) => ({
      name,
      browser_download_url: download(tag, name),
    })),
    ...overrides,
  }
}

describe("installerName", () => {
  it("names the installer each platform downloads", () => {
    expect(installerName("windows", "x86_64")).toBe("KnightCode-x86_64.exe")
    expect(installerName("macos", "aarch64")).toBe("KnightCode-aarch64.dmg")
    expect(installerName("macos", "x86_64")).toBe("KnightCode-x86_64.dmg")
    expect(installerName("linux", "x86_64")).toBe(
      "knightcode-linux-x86_64.tar.gz"
    )
    expect(installerName("linux", "aarch64")).toBe(
      "knightcode-linux-aarch64.tar.gz"
    )
  })

  it("has nothing for a platform that is not built", () => {
    expect(installerName("windows", "aarch64")).toBeNull()
    expect(installerName("freebsd", "x86_64")).toBeNull()
    expect(installerName(null, null)).toBeNull()
  })
})

describe("pickInstaller", () => {
  it("returns the version without its v, the installer and its signature", () => {
    expect(pickInstaller(release(), "KnightCode-x86_64.exe")).toEqual({
      version: "0.2.0",
      url: download("v0.2.0", "KnightCode-x86_64.exe"),
      signatureUrl: download("v0.2.0", "KnightCode-x86_64.exe.sig"),
    })
  })

  it("offers nothing without a signature beside the installer", () => {
    expect(
      pickInstaller(release(), "knightcode-linux-x86_64.tar.gz")
    ).toBeNull()
  })

  it("offers nothing the release does not carry", () => {
    expect(pickInstaller(release(), "KnightCode-aarch64.dmg")).toBeNull()
  })

  it("never offers a draft or a prerelease", () => {
    expect(
      pickInstaller(release({ draft: true }), "KnightCode-x86_64.exe")
    ).toBeNull()
    expect(
      pickInstaller(release({ prerelease: true }), "KnightCode-x86_64.exe")
    ).toBeNull()
  })
})
