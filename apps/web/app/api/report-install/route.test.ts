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
  it("records a CLI install with the fields its user agent carries", async () => {
    await GET(ping("?version=0.4.2"))
    expect(sent).toHaveLength(1)
    expect(sent[0].body.event).toBe("cli_install")
    const cli = sent[0].body.properties as Record<string, unknown>
    expect(cli.product).toBe("knightcode")
    expect(cli.version).toBe("0.4.2")
    expect(cli.os).toBe("win32")
    expect(cli.arch).toBe("x64")
  })

  it("drops pings from the discontinued IDE", async () => {
    const response = await GET(ping("?version=1.0.0", { ua: IDE_UA }))
    expect(response.status).toBe(204)
    expect(sent).toHaveLength(0)
  })

  it("disables PostHog's own geoip, which describes Vercel's egress", async () => {
    await GET(ping("?version=1.0.0"))
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
    await GET(ping("?version=1.0.0"))
    const wire = JSON.stringify(sent[0].body)
    expect(wire).not.toContain("203.0.113.7")
    expect(wire).not.toContain(CLI_UA)
  })
})

describe("launch signals", () => {
  it("rejects every event, including the IDE's old ones, and sends nothing", async () => {
    for (const event of ["ide_first_run", "ide_keystroke"]) {
      const response = await GET(ping(`?version=1.0.0&event=${event}`, { ua: IDE_UA }))
      expect(response.status).toBe(400)
    }
    expect(sent).toHaveLength(0)
  })
})

describe("without a write key", () => {
  it("answers 204 and makes no outbound call", async () => {
    delete process.env.POSTHOG_KEY
    const response = await GET(ping("?version=1.0.0"))
    expect(response.status).toBe(204)
    expect(sent).toHaveLength(0)
  })

  it("still rejects an event", async () => {
    delete process.env.POSTHOG_KEY
    const response = await GET(ping("?version=1.0.0&event=whatever"))
    expect(response.status).toBe(400)
    expect(sent).toHaveLength(0)
  })
})
