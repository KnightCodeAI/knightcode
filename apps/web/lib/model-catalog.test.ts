import { describe, expect, it } from "bun:test"

import {
  isValidProviderId,
  parseClientVersion,
  parseIndex,
  pickCatalog,
  providerShardKey,
} from "./model-catalog"

const revision = (marker: string) => `sha256-${marker.repeat(64).slice(0, 64)}`

const OLD = revision("a")
const CURRENT = revision("b")

const INDEX = {
  schemaVersion: 1,
  defaultRevision: CURRENT,
  catalogs: [
    {
      minimumKnightcodeVersion: "0.1.0",
      revision: OLD,
      publishedAt: "2026-08-01T10:00:00.000Z",
    },
    {
      minimumKnightcodeVersion: "0.5.0",
      revision: CURRENT,
      publishedAt: "2026-08-31T18:48:00.000Z",
    },
  ],
}

describe("parseIndex", () => {
  it("accepts the shape publish-model-catalog.mjs writes", () => {
    expect(parseIndex(INDEX)?.defaultRevision).toBe(CURRENT)
  })

  it("rejects a foreign schema, shape, or revision", () => {
    expect(parseIndex({ ...INDEX, schemaVersion: 2 })).toBeUndefined()
    expect(parseIndex({ ...INDEX, defaultRevision: "latest" })).toBeUndefined()
    expect(parseIndex([INDEX])).toBeUndefined()
    expect(parseIndex(null)).toBeUndefined()
  })

  it("drops catalog entries that are not usable", () => {
    const index = parseIndex({
      ...INDEX,
      catalogs: [
        ...INDEX.catalogs,
        { minimumKnightcodeVersion: "9.0.0" },
        { minimumKnightcodeVersion: "9.0.0", revision: "latest" },
      ],
    })
    expect(index?.catalogs).toHaveLength(2)
  })

  // compareVersions is numeric: a gate that is not a version compares as NaN,
  // which reads as satisfied by every client and would leak a gated revision.
  it("drops a gate that is not a version", () => {
    const index = parseIndex({
      ...INDEX,
      catalogs: [
        ...INDEX.catalogs,
        { minimumKnightcodeVersion: "not-a-version", revision: OLD },
      ],
    })
    expect(index?.catalogs).toHaveLength(2)
    expect(pickCatalog(index!, "0.0.1")).toBeUndefined()
  })

  it("rejects an index left with no usable gate at all", () => {
    expect(parseIndex({ ...INDEX, catalogs: [] })).toBeUndefined()
    expect(
      parseIndex({ ...INDEX, catalogs: [{ revision: CURRENT }] })
    ).toBeUndefined()
  })
})

describe("pickCatalog", () => {
  const index = parseIndex(INDEX)!

  it("picks the newest gate the client satisfies", () => {
    expect(pickCatalog(index, "0.5.0")?.revision).toBe(CURRENT)
    expect(pickCatalog(index, "1.2.0")?.revision).toBe(CURRENT)
  })

  it("holds an older client on the revision it can read", () => {
    expect(pickCatalog(index, "0.4.1")?.revision).toBe(OLD)
  })

  it("gives a client below every gate nothing", () => {
    expect(pickCatalog(index, "0.0.9")).toBeUndefined()
  })

  it("falls back to the default revision without a client version", () => {
    expect(pickCatalog(index, undefined)?.revision).toBe(CURRENT)
  })

  // The client discards the whole overlay when Last-Modified is missing or
  // older than its built-in model data, so the entry has to carry the stamp.
  it("carries publishedAt through, for the Last-Modified header", () => {
    expect(pickCatalog(index, "0.5.0")?.publishedAt).toBe(
      "2026-08-31T18:48:00.000Z"
    )
  })
})

describe("parseClientVersion", () => {
  it("reads the version out of the CLI User-Agent", () => {
    const agent = "knightcode/0.5.0 (win32; bun/1.3.3; x64)"
    expect(parseClientVersion(agent)).toBe("0.5.0")
  })

  it("ignores anything else", () => {
    expect(parseClientVersion("curl/8.4.0")).toBeUndefined()
    expect(parseClientVersion(null)).toBeUndefined()
  })
})

describe("isValidProviderId", () => {
  it("accepts the ids the publisher shards by", () => {
    expect(isValidProviderId("anthropic")).toBe(true)
    expect(isValidProviderId("amazon-bedrock")).toBe(true)
  })

  it("refuses anything that could escape the key prefix", () => {
    expect(isValidProviderId("../../index")).toBe(false)
    expect(isValidProviderId("a/b")).toBe(false)
    expect(isValidProviderId("")).toBe(false)
    // Passes the character class and is caught only by the dot-dot check.
    expect(isValidProviderId("a..b")).toBe(false)
  })

  it("keeps a valid id inside the revision prefix", () => {
    expect(providerShardKey(CURRENT, "anthropic")).toBe(
      `models/v1/revisions/${CURRENT}/providers/anthropic.json`
    )
  })
})
