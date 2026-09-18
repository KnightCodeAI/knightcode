import { afterEach, beforeEach, describe, expect, it } from "bun:test"

import { GET } from "./route"

type Sent = { url: string; body: Record<string, unknown> }

const realFetch = globalThis.fetch
const realKey = process.env.POSTHOG_KEY
let sent: Sent[] = []

function stubFetch() {
  sent = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")),
    })
    return new Response(null, { status: 200 })
  }) as typeof fetch
}

const CLI_UA = "knightcode/0.4.2 (win32; bun/1.3.3; x64)"
const IDE_UA = "knightcode-ide/1.0.0 (windows; rust; x86_64)"

function ping(
  query: string,
  { ua = CLI_UA, ip = "203.0.113.7" }: { ua?: string; ip?: string } = {}
): Request {
  return new Request(`https://knightcode.dev/api/report-install${query}`, {
    headers: {
      "user-agent": ua,
      "x-forwarded-for": ip,
      "x-vercel-ip-country": "GB",
      "x-vercel-ip-country-region": "ENG",
      "x-vercel-ip-city": "London",
    },
  })
}

beforeEach(() => {
  process.env.POSTHOG_KEY = "phc_test"
  stubFetch()
})

afterEach(() => {
  globalThis.fetch = realFetch
  if (realKey === undefined) delete process.env.POSTHOG_KEY
  else process.env.POSTHOG_KEY = realKey
})

describe("install pings", () => {
  it("tells the IDE and the CLI apart by user agent", async () => {
    await GET(ping("?version=1.0.0", { ua: IDE_UA }))
    expect(sent).toHaveLength(1)
    expect(sent[0].body.event).toBe("ide_install")
    const ide = sent[0].body.properties as Record<string, unknown>
    expect(ide.product).toBe("knightcode-ide")
    expect(ide.version).toBe("1.0.0")
    expect(ide.os).toBe("windows")
    expect(ide.arch).toBe("x86_64")

    stubFetch()
    await GET(ping("?version=0.4.2"))
    expect(sent[0].body.event).toBe("cli_install")
    const cli = sent[0].body.properties as Record<string, unknown>
    expect(cli.product).toBe("knightcode")
    expect(cli.version).toBe("0.4.2")
    expect(cli.os).toBe("win32")
    expect(cli.arch).toBe("x64")
  })

  it("disables PostHog's own geoip, which describes Vercel's egress", async () => {
    await GET(ping("?version=1.0.0", { ua: IDE_UA }))
    const props = sent[0].body.properties as Record<string, unknown>
    expect(props.$geoip_disable).toBe(true)
    expect(props.country).toBe("GB")
    expect(props.city).toBe("London")
  })
})

describe("the anonymous id", () => {
  it("is stable for one machine and different for another address", async () => {
    await GET(ping("?version=1.0.0"))
    const first = sent[0].body.distinct_id

    stubFetch()
    await GET(ping("?version=1.0.0"))
    expect(sent[0].body.distinct_id).toBe(first)

    stubFetch()
    await GET(ping("?version=1.0.0", { ip: "198.51.100.9" }))
    expect(sent[0].body.distinct_id).not.toBe(first)
  })

  it("never carries the address or the raw user agent", async () => {
    await GET(ping("?version=1.0.0", { ua: IDE_UA }))
    const wire = JSON.stringify(sent[0].body)
    expect(wire).not.toContain("203.0.113.7")
    expect(wire).not.toContain(IDE_UA)
  })
})

describe("the launch-signal allowlist", () => {
  const allowed: Array<[string, string, string]> = [
    ["ide_first_run", "outcome", "completed"],
    ["ide_engine_failed", "reason", "binary_missing"],
    ["ide_first_turn", "provider", "anthropic"],
    ["ide_seam_first_use", "seam", "buffer_inline_assist"],
  ]

  for (const [event, property, value] of allowed) {
    it(`accepts ${event}`, async () => {
      const response = await GET(
        ping(`?version=1.0.0&event=${event}&${property}=${value}`, { ua: IDE_UA })
      )
      expect(response.status).toBe(204)
      expect(sent).toHaveLength(1)
      expect(sent[0].body.event).toBe(event)
      expect((sent[0].body.properties as Record<string, unknown>)[property]).toBe(value)
    })
  }

  it("rejects an event that is not on it, and sends nothing", async () => {
    const response = await GET(ping("?version=1.0.0&event=ide_keystroke", { ua: IDE_UA }))
    expect(response.status).toBe(400)
    expect(sent).toHaveLength(0)
  })

  it("truncates a property value rather than passing it through", async () => {
    const long = "x".repeat(500)
    await GET(ping(`?version=1.0.0&event=ide_engine_failed&reason=${long}`, { ua: IDE_UA }))
    const props = sent[0].body.properties as Record<string, unknown>
    expect((props.reason as string).length).toBe(64)
  })
})

describe("without a write key", () => {
  it("answers 204 and makes no outbound call", async () => {
    delete process.env.POSTHOG_KEY
    const response = await GET(ping("?version=1.0.0"))
    expect(response.status).toBe(204)
    expect(sent).toHaveLength(0)
  })

  it("still rejects an unlisted event", async () => {
    delete process.env.POSTHOG_KEY
    const response = await GET(ping("?version=1.0.0&event=whatever"))
    expect(response.status).toBe(400)
    expect(sent).toHaveLength(0)
  })
})
