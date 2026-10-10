// Install/update ping from packages/cli/src/modes/interactive/interactive-mode.ts
// (reportInstallTelemetry). The CLI ignores the response, so this only has to
// exist and be cheap; without it every ping 404s and the count is lost.
//
// Set POSTHOG_KEY (project write token) in Vercel to record the pings. Unset,
// the route still answers 204 and the ping is simply dropped — a preview
// deployment reports nothing and a missing secret is never an outage.
//
// The route is the only thing that holds the write key. A key compiled into a
// client would be a key published in a public GPL repository.
const POSTHOG_HOST = "https://us.i.posthog.com"

// packages/cli/src/utils/user-agent.ts builds exactly this shape:
//   knightcode/0.4.2 (win32; bun/1.3.3; x64)
const UA = /^knightcode\/(\S+) \(([^;]+); ([^;]+); ([^)]+)\)$/

// The discontinued desktop IDE sent knightcode-ide/<version> pings and
// ?event= launch signals. Installed copies keep sending them; they are not CLI
// installs, so they are dropped rather than counted.
const RETIRED_IDE_UA = /^knightcode-ide\//

// The ping carries no identity. Hash IP+UA so repeat pings from one machine
// collapse into one person in PostHog without ever storing the address.
async function anonId(ip: string, ua: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ip}|${ua}`))
  return Array.from(new Uint8Array(digest).slice(0, 16))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const h = request.headers
  const ua = h.get("user-agent") ?? ""

  // No launch signals are accepted any more. Rejecting them before the key
  // check keeps `?event=bogus` a liveness probe that writes nothing.
  if (url.searchParams.has("event")) return new Response(null, { status: 400 })

  const key = process.env.POSTHOG_KEY
  if (!key || RETIRED_IDE_UA.test(ua)) return new Response(null, { status: 204 })

  const [, uaVersion, os, runtime, arch] = UA.exec(ua) ?? []

  // ponytail: fire-and-forget, one event per ping. Batch via /batch/ only if
  // install volume ever makes per-request latency show up.
  await fetch(`${POSTHOG_HOST}/i/v0/e/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      event: "cli_install",
      distinct_id: await anonId(h.get("x-forwarded-for") ?? "", ua),
      properties: {
        product: "knightcode",
        // The query param is what the CLI reports; the UA copy is a cross-check.
        version: url.searchParams.get("version") ?? "unknown",
        ua_version: uaVersion ?? "",
        os: os ?? "", // win32 | darwin | linux
        runtime: runtime ?? "", // bun/1.3.3 | node/v22.11.0
        arch: arch ?? "", // x64 | arm64
        country: h.get("x-vercel-ip-country") ?? "",
        region: h.get("x-vercel-ip-country-region") ?? "",
        city: h.get("x-vercel-ip-city") ?? "",
        // PostHog derives $geoip_* from the address that reaches /i/v0/e/, which is
        // Vercel's egress rather than the user's, so every $geoip_country_name on
        // these events was wrong. The true location is in country/region/city above.
        $geoip_disable: true,
        $lib: "knightcode-web",
      },
    }),
    signal: AbortSignal.timeout(3000),
  }).catch(() => undefined)

  return new Response(null, { status: 204 })
}
