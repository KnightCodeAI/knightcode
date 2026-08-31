import {
  catalogIndexKey,
  isValidProviderId,
  parseClientVersion,
  parseIndex,
  pickCatalog,
  providerShardKey,
} from "@/lib/model-catalog"

// Serves the model catalog that publish-model-catalog.yml uploads to R2, for
// packages/cli/src/core/remote-catalog-provider.ts. The bucket stays private:
// reads go through the Cloudflare API with a token scoped to R2 read only.
const ACCOUNT_ID = process.env.CF_ACCOUNT_ID
const R2_READ_TOKEN = process.env.R2_READ_TOKEN
const BUCKET = process.env.R2_CATALOG_BUCKET ?? "knightcode-artifacts"

// index.json is the only mutable object in the layout; revisions are immutable
// and content-addressed, so the shard outlives the pointer that selects it.
const INDEX_REVALIDATE_SECONDS = 300
const SHARD_REVALIDATE_SECONDS = 86_400

// Cached upstream reads also keep this route well under the Cloudflare API's
// per-account request limit, which a per-provider passthrough would approach:
// a cold client asks once per provider.
function readObject(key: string, revalidate: number) {
  const url =
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}` +
    `/r2/buckets/${BUCKET}/objects/${encodeURIComponent(key)}`
  return fetch(url, {
    headers: { authorization: `Bearer ${R2_READ_TOKEN}` },
    cache: "force-cache",
    next: { revalidate },
  })
}

// A proxy may weaken the validator on the way back; the client returns whatever
// it was given, so compare on the entity tag itself.
function matches(ifNoneMatch: string | null, etag: string) {
  return ifNoneMatch !== null && ifNoneMatch.replace(/^W\//, "") === etag
}

function httpDate(value: string | null | undefined) {
  if (!value) return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toUTCString()
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 501 and 404 both mean "no remote catalog" to the client: it persists that
  // and stops asking for the rest of the refresh window, instead of retrying a
  // deployment that has no credentials.
  if (!ACCOUNT_ID || !R2_READ_TOKEN) return new Response(null, { status: 501 })

  const { id } = await params
  if (!isValidProviderId(id)) return new Response(null, { status: 404 })

  try {
    const indexResponse = await readObject(
      catalogIndexKey(),
      INDEX_REVALIDATE_SECONDS
    )
    // Anything else is transient as far as the client is concerned: it keeps
    // the catalog it already has and revalidates on the next refresh. An
    // unreachable upstream or unparseable body lands in the catch for the same
    // reason, rather than escaping as a 500 with an HTML body.
    if (!indexResponse.ok) return new Response(null, { status: 502 })
    const index = parseIndex(await indexResponse.json())
    if (!index) return new Response(null, { status: 502 })

    const catalog = pickCatalog(
      index,
      parseClientVersion(request.headers.get("user-agent"))
    )
    // Below every minimum-version gate: no catalog this client can read.
    if (!catalog) return new Response(null, { status: 404 })

    // Revisions are immutable, so revision + provider identifies the body
    // exactly. A revalidating client then costs one cached index read and no
    // shard body.
    const etag = `"${catalog.revision}-${id}"`
    if (matches(request.headers.get("if-none-match"), etag)) {
      return new Response(null, { status: 304, headers: { etag } })
    }

    const shard = await readObject(
      providerShardKey(catalog.revision, id),
      SHARD_REVALIDATE_SECONDS
    )
    if (shard.status === 404) return new Response(null, { status: 404 })
    if (!shard.ok) return new Response(null, { status: 502 })

    // Required, not decorative: the client compares this against the build
    // timestamp of its own model data and discards the whole overlay when the
    // header is missing or older (remote-catalog-provider.ts, remoteModels).
    const lastModified =
      httpDate(catalog.publishedAt) ??
      httpDate(shard.headers.get("last-modified"))

    return new Response(await shard.text(), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        etag,
        ...(lastModified ? { "last-modified": lastModified } : {}),
        // The body is selected by the caller's version, so a shared cache keyed
        // on the URL alone would hand one client another's revision and defeat
        // the gate.
        vary: "user-agent",
        "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    })
  } catch {
    return new Response(null, { status: 502 })
  }
}
