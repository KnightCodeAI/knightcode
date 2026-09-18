// Anonymous pings from the CLI and the IDE.
//
// Install/update: packages/cli/src/modes/interactive/interactive-mode.ts
// (reportInstallTelemetry) and packages/cli/src/engine/install-report.ts
// (reportIdeInstall). Launch signals: the IDE's crates/knightcode_engine/src/report.rs.
// Every caller ignores the response, so this only has to exist and be cheap;
// without it every ping 404s and the count is lost.
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
//   knightcode-ide/1.0.0 (windows; rust; x86_64)
const UA = /^(knightcode|knightcode-ide)\/(\S+) \(([^;]+); ([^;]+); ([^)]+)\)$/

// The closed allowlist from apps/desktop/docs/architecture.md §12.1. Server-side
// enforcement matters because this route is public: without it anyone can write
// anything into the project. Adding a sixth event is an amendment to §12.1.
const INSTALL_EVENTS: Record<string, string> = {
  knightcode: "cli_install",
  "knightcode-ide": "ide_install",
}

// Each launch signal names the one property it may carry. Nothing else on the
// query string is read, so a caller cannot invent a property either.
const LAUNCH_EVENTS: Record<string, string> = {
  ide_first_run: "outcome",
  ide_engine_failed: "reason",
  ide_first_turn: "provider",
  ide_seam_first_use: "seam",
}

// Long enough for every value the enums in report.rs render, short enough that
// nobody can smuggle a path or a prompt through one.
const MAX_VALUE_LENGTH = 64

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
  const [, product, uaVersion, os, runtime, arch] = UA.exec(ua) ?? []

  const requested = url.searchParams.get("event")
  const isLaunchSignal = requested !== null

  if (isLaunchSignal && !(requested in LAUNCH_EVENTS)) {
    return new Response(null, { status: 400 })
  }

  const event = isLaunchSignal ? requested : (INSTALL_EVENTS[product ?? ""] ?? "cli_install")

  const key = process.env.POSTHOG_KEY
  if (!key) return new Response(null, { status: 204 })

  const properties: Record<string, string | boolean> = {
    // "knightcode" | "knightcode-ide". Identical property names across every
    // event, so a `product` breakdown works without a formula.
    product: product ?? "knightcode",
    // The query param is what the client reports; the UA copy is a cross-check.
    version: url.searchParams.get("version") ?? "unknown",
    ua_version: uaVersion ?? "",
    os: os ?? "", // win32 | darwin | linux | windows | macos
    runtime: runtime ?? "", // bun/1.3.3 | node/v22.11.0 | rust
    arch: arch ?? "", // x64 | arm64 | x86_64 | aarch64
    country: h.get("x-vercel-ip-country") ?? "",
    region: h.get("x-vercel-ip-country-region") ?? "",
    city: h.get("x-vercel-ip-city") ?? "",
    // PostHog derives $geoip_* from the address that reaches /i/v0/e/, which is
    // Vercel's egress rather than the user's, so every $geoip_country_name on
    // these events was wrong. The true location is in country/region/city above.
    $geoip_disable: true,
    $lib: "knightcode-web",
  }

  if (isLaunchSignal) {
    const name = LAUNCH_EVENTS[requested]
    properties[name] = (url.searchParams.get(name) ?? "").slice(0, MAX_VALUE_LENGTH)
  }

  // ponytail: fire-and-forget, one event per ping. Batch via /batch/ only if
  // install volume ever makes per-request latency show up.
  await fetch(`${POSTHOG_HOST}/i/v0/e/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      event,
      distinct_id: await anonId(h.get("x-forwarded-for") ?? "", ua),
      properties,
    }),
    signal: AbortSignal.timeout(3000),
  }).catch(() => undefined)

  return new Response(null, { status: 204 })
}
