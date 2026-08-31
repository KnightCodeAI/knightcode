import { describe, expect, it } from "bun:test"

import {
  isValidProviderId,
  parseClientVersion,
  parseIndex,
  pickRevision,
  providerShardKey,
} from "./model-catalog"

const revision = (marker: string) => `sha256-${marker.repeat(64).slice(0, 64)}`

const OLD = revision("a")
const CURRENT = revision("b")

const INDEX = {
  schemaVersion: 1,
  defaultRevision: CURRENT,
  catalogs: [
    { minimumKnightcodeVersion: "0.1.0", revision: OLD },
    { minimumKnightcodeVersion: "0.5.0", revision: CURRENT },
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
      catalogs: [...INDEX.catalogs, { minimumKnightcodeVersion: "9.0.0" }],
    })
    expect(index?.catalogs).toHaveLength(2)
  })
})

describe("pickRevision", () => {
  const index = parseIndex(INDEX)!

  it("picks the newest gate the client satisfies", () => {
    expect(pickRevision(index, "0.5.0")).toBe(CURRENT)
    expect(pickRevision(index, "1.2.0")).toBe(CURRENT)
  })

  it("holds an older client on the revision it can read", () => {
    expect(pickRevision(index, "0.4.1")).toBe(OLD)
  })

  it("gives a client below every gate nothing", () => {
    expect(pickRevision(index, "0.0.9")).toBeUndefined()
  })

  it("falls back to the default revision without a client version", () => {
    expect(pickRevision(index, undefined)).toBe(CURRENT)
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
  })

  it("keeps a valid id inside the revision prefix", () => {
    expect(providerShardKey(CURRENT, "anthropic")).toBe(
      `models/v1/revisions/${CURRENT}/providers/anthropic.json`
    )
  })
})
