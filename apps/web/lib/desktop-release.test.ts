import { describe, expect, it } from "bun:test"

import {
  type DesktopRelease,
  fetchDesktopReleases,
  latestDesktopRelease,
  macUpdate,
  squirrelReleases,
} from "./desktop-release"
import { GET as getMac } from "../app/api/desktop/update/[platform]/[version]/route"
import { GET as getReleases } from "../app/api/desktop/update/[platform]/[version]/RELEASES/route"

const DOWNLOAD = "https://github.com/KnightCodeAI/knightcode/releases/download"

function release(
  tag: string,
  options: Partial<DesktopRelease> & { files?: string[] } = {}
): DesktopRelease {
  const { files = [], ...rest } = options
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    html_url: `https://github.com/KnightCodeAI/knightcode/releases/tag/${tag}`,
    body: `Notes for ${tag}`,
    published_at: "2026-10-23T00:00:00Z",
    assets: files.map((name) => ({
      name,
      browser_download_url: `${DOWNLOAD}/${tag}/${name}`,
    })),
    ...rest,
  }
}

function requestUrl(input: string | URL | Request): string {
  return typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : input.url
}

async function withFetch<T>(
  answer: (url: string) => Response,
  run: () => Promise<T>
): Promise<T> {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request) =>
    answer(requestUrl(input))) as typeof fetch
  try {
    return await run()
  } finally {
    globalThis.fetch = original
  }
}

const params = (platform: string, version: string) => ({
  params: Promise.resolve({ platform, version }),
})

describe("desktop update feed", () => {
  it("offers the newest published desktop release, never a draft, prerelease or CLI release", () => {
    const latest = latestDesktopRelease([
      release("desktop-v0.2.0"),
      release("desktop-v0.10.0"),
      release("desktop-v0.11.0", { draft: true }),
      release("desktop-v0.12.0", { prerelease: true }),
      release("@knightcodeai/cli@0.30.0"),
      release("desktop-v1.0"),
    ])
    expect(latest?.version).toBe("0.10.0")
  })

  it("points Squirrel's RELEASES at the release's packages and drops unknown files", () => {
    const r = release("desktop-v0.2.0", {
      files: ["KnightCodeDesktop-0.2.0-full.nupkg"],
    })
    const text =
      // Squirrel writes it with a byte order mark.
      "﻿A1B2 KnightCodeDesktop-0.2.0-full.nupkg 1234\r\nC3D4 KnightCodeDesktop-0.2.0-delta.nupkg 99\r\n"
    expect(squirrelReleases(text, r)).toBe(
      `A1B2 ${DOWNLOAD}/desktop-v0.2.0/KnightCodeDesktop-0.2.0-full.nupkg 1234`
    )
  })

  it("offers a Mac only a newer release with a build for its architecture", () => {
    const latest = {
      version: "0.2.0",
      release: release("desktop-v0.2.0", {
        files: [
          "KnightCode-darwin-arm64-0.2.0.zip",
          "KnightCode-0.2.0-arm64.dmg",
        ],
      }),
    }
    expect(macUpdate(latest, "0.1.0", "arm64")).toEqual({
      version: "0.2.0",
      url: "https://github.com/KnightCodeAI/knightcode/releases/tag/desktop-v0.2.0",
      notes: "Notes for desktop-v0.2.0",
      pub_date: "2026-10-23T00:00:00Z",
    })
    expect(macUpdate(latest, "0.2.0", "arm64")).toBeNull()
    expect(macUpdate(latest, "0.1.0", "x64")).toBeNull()
    expect(macUpdate(latest, "not-a-version", "arm64")).toBeNull()
  })

  it("answers the Mac's check with the update, 204 when up to date, 404 for another platform", async () => {
    const releases = [
      release("desktop-v0.2.0", { files: ["KnightCode-0.2.0-x64.dmg"] }),
    ]
    await withFetch(
      () => Response.json(releases),
      async () => {
        const newer = await getMac(
          new Request("http://localhost"),
          params("darwin-x64", "0.1.0")
        )
        expect(newer.status).toBe(200)
        expect((await newer.json()).version).toBe("0.2.0")
        const current = await getMac(
          new Request("http://localhost"),
          params("darwin-x64", "0.2.0")
        )
        expect(current.status).toBe(204)
        const intelOnly = await getMac(
          new Request("http://localhost"),
          params("darwin-arm64", "0.1.0")
        )
        expect(intelOnly.status).toBe(204)
        const windows = await getMac(
          new Request("http://localhost"),
          params("win32-x64", "0.1.0")
        )
        expect(windows.status).toBe(404)
      }
    )
  })

  it("answers Squirrel's RELEASES from the newest release, 404 before there is one", async () => {
    const r = release("desktop-v0.2.0", {
      files: ["RELEASES", "KnightCodeDesktop-0.2.0-full.nupkg"],
    })
    await withFetch(
      (url) =>
        url.startsWith("https://api.github.com/")
          ? Response.json([r])
          : new Response("ABCD KnightCodeDesktop-0.2.0-full.nupkg 42\n"),
      async () => {
        const res = await getReleases(
          new Request("http://localhost"),
          params("win32-x64", "0.1.0")
        )
        expect(res.status).toBe(200)
        expect(await res.text()).toBe(
          `ABCD ${DOWNLOAD}/desktop-v0.2.0/KnightCodeDesktop-0.2.0-full.nupkg 42`
        )
      }
    )
    await withFetch(
      () => Response.json([]),
      async () => {
        const res = await getReleases(
          new Request("http://localhost"),
          params("win32-x64", "0.1.0")
        )
        expect(res.status).toBe(404)
      }
    )
  })

  it("reads past pages of CLI releases to the newest desktop release, and no further", async () => {
    const pages: number[] = []
    const cli = Array.from({ length: 100 }, (_, i) =>
      release(`@knightcodeai/cli@0.${300 - i}.0`)
    )
    const fetchImpl = (async (input: string | URL | Request) => {
      const page = Number(new URL(requestUrl(input)).searchParams.get("page"))
      pages.push(page)
      return Response.json(
        page === 1 ? cli : page === 2 ? [release("desktop-v0.3.0")] : []
      )
    }) as typeof fetch
    const releases = await fetchDesktopReleases(fetchImpl)
    expect(latestDesktopRelease(releases ?? [])?.version).toBe("0.3.0")
    expect(pages).toEqual([1, 2])
  })

  it("offers a Mac the newest release with its build, past a newer one without it", async () => {
    const releases = [
      release("desktop-v0.3.0", { files: ["KnightCode-0.3.0-x64.dmg"] }),
      release("desktop-v0.2.0", { files: ["KnightCode-0.2.0-arm64.dmg"] }),
    ]
    await withFetch(
      () => Response.json(releases),
      async () => {
        const res = await getMac(
          new Request("http://localhost"),
          params("darwin-arm64", "0.1.0")
        )
        expect(res.status).toBe(200)
        expect((await res.json()).version).toBe("0.2.0")
      }
    )
  })
})
