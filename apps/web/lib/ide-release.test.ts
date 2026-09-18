import { describe, expect, it } from "bun:test"

import {
  type GithubRelease,
  guessPlatform,
  installerName,
  pickInstaller,
} from "./ide-release"

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

describe("guessPlatform", () => {
  const UA = {
    windows:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    safariMac:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
    chromeLinux:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    firefoxLinuxArm:
      "Mozilla/5.0 (X11; Linux aarch64; rv:142.0) Gecko/20100101 Firefox/142.0",
    iphone:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
    android:
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  }

  it("offers Windows the x64 build whatever the chip", () => {
    expect(guessPlatform({ userAgent: UA.windows })).toEqual(["windows-x86_64"])
    expect(
      guessPlatform({ userAgent: UA.windows, architecture: "arm" })
    ).toEqual(["windows-x86_64"])
  })

  it("offers both Mac builds until the browser names the chip", () => {
    // An Intel Mac and an Apple silicon Mac send this same user agent.
    expect(guessPlatform({ userAgent: UA.safariMac })).toEqual([
      "macos-aarch64",
      "macos-x86_64",
    ])
    expect(
      guessPlatform({ userAgent: UA.safariMac, architecture: "x86" })
    ).toEqual(["macos-x86_64"])
    expect(
      guessPlatform({ userAgent: UA.safariMac, architecture: "arm" })
    ).toEqual(["macos-aarch64"])
  })

  it("prefers the Client Hint over Chrome's frozen Linux x86_64", () => {
    expect(guessPlatform({ userAgent: UA.chromeLinux })).toEqual([
      "linux-x86_64",
    ])
    expect(
      guessPlatform({ userAgent: UA.chromeLinux, architecture: "arm" })
    ).toEqual(["linux-aarch64"])
    expect(guessPlatform({ userAgent: UA.firefoxLinuxArm })).toEqual([
      "linux-aarch64",
    ])
  })

  it("offers nothing to a phone or tablet", () => {
    expect(guessPlatform({ userAgent: UA.iphone })).toEqual([])
    expect(guessPlatform({ userAgent: UA.android })).toEqual([])
    // iPadOS Safari reports itself as a Mac.
    expect(guessPlatform({ userAgent: UA.safariMac, mobile: true })).toEqual([])
    expect(guessPlatform({ userAgent: "" })).toEqual([])
  })
})
