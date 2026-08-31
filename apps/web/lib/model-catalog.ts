// Resolution rules for the model catalog published to R2 by
// scripts/publish-model-catalog.mjs. The CLI asks only for a provider
// (packages/cli/src/core/remote-catalog-provider.ts), so picking the revision
// its version is allowed to read happens here, on the server.

export const CATALOG_SCHEMA_VERSION = 1
const CATALOG_PREFIX = `models/v${CATALOG_SCHEMA_VERSION}`

export interface CatalogEntry {
  minimumKnightcodeVersion: string
  revision: string
  publishedAt?: string
}

export interface CatalogIndex {
  schemaVersion: number
  defaultRevision: string
  catalogs: CatalogEntry[]
}

export function catalogIndexKey() {
  return `${CATALOG_PREFIX}/index.json`
}

export function providerShardKey(revision: string, providerId: string) {
  return `${CATALOG_PREFIX}/revisions/${revision}/providers/${providerId}.json`
}

// Provider ids and revisions are interpolated into an object key, so both are
// checked against the shapes the publisher actually writes rather than escaped.
export function isValidProviderId(value: string) {
  return /^[a-z0-9][a-z0-9._-]*$/i.test(value) && !value.includes("..")
}

function isValidRevision(value: string) {
  return /^sha256-[a-f0-9]{64}$/.test(value)
}

// compareVersions is numeric, so a gate that is not a version compares as NaN
// and reads as satisfied by every client. Drop those entries instead.
function isValidVersion(value: string) {
  return /^\d+\.\d+\.\d+$/.test(value)
}

/** `knightcode/0.5.0 (win32; bun/1.3.3; x64)` -> `0.5.0`. */
export function parseClientVersion(userAgent: string | null) {
  return /^knightcode\/(\d+\.\d+\.\d+)/.exec(userAgent ?? "")?.[1]
}

function compareVersions(left: string, right: string) {
  const leftParts = left.split(".").map(Number)
  const rightParts = right.split(".").map(Number)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index++) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0)
    if (difference !== 0) return difference
  }
  return 0
}

export function parseIndex(value: unknown): CatalogIndex | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined
  }
  const index = value as Partial<CatalogIndex>
  if (index.schemaVersion !== CATALOG_SCHEMA_VERSION) return undefined
  if (typeof index.defaultRevision !== "string") return undefined
  if (!isValidRevision(index.defaultRevision)) return undefined
  if (!Array.isArray(index.catalogs)) return undefined
  const catalogs: CatalogEntry[] = index.catalogs.filter(
    (entry): entry is CatalogEntry =>
      typeof entry === "object" &&
      entry !== null &&
      typeof entry.minimumKnightcodeVersion === "string" &&
      isValidVersion(entry.minimumKnightcodeVersion) &&
      typeof entry.revision === "string" &&
      isValidRevision(entry.revision)
  )
  // The publisher always writes at least one gate, so an index that has none
  // left after validation is malformed rather than ungated.
  if (catalogs.length === 0) return undefined
  return {
    schemaVersion: index.schemaVersion,
    defaultRevision: index.defaultRevision,
    catalogs,
  }
}

/**
 * The newest catalog whose minimum-version gate the client satisfies, so a
 * client too old for current metadata keeps resolving an older revision
 * instead of choking on fields it cannot read. An unrecognised User-Agent
 * gets the default revision; a client below every gate gets nothing.
 *
 * Returns the entry rather than the revision because the response needs the
 * entry's publishedAt as its Last-Modified.
 */
export function pickCatalog(index: CatalogIndex, clientVersion?: string) {
  if (clientVersion === undefined) {
    const entry = index.catalogs.find(
      (candidate) => candidate.revision === index.defaultRevision
    )
    return (
      entry ?? {
        minimumKnightcodeVersion: "0.0.0",
        revision: index.defaultRevision,
      }
    )
  }
  let picked: CatalogEntry | undefined
  for (const entry of index.catalogs) {
    if (compareVersions(clientVersion, entry.minimumKnightcodeVersion) < 0) {
      continue
    }
    if (
      picked === undefined ||
      compareVersions(
        entry.minimumKnightcodeVersion,
        picked.minimumKnightcodeVersion
      ) >= 0
    ) {
      picked = entry
    }
  }
  return picked
}
