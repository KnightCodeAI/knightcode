import { describe, expect, it } from "bun:test"

import { GET as getShared } from "../../client.json/route"
import { GET } from "./route"

function get(id: string) {
  return GET(new Request(`https://knightcode.dev/oauth/${id}/client.json`), {
    params: Promise.resolve({ id }),
  })
}

describe("OAuth client metadata documents", () => {
  it("names itself and lists the loopback callback", async () => {
    const body = await getShared().json()
    expect(body.client_id).toBe("https://knightcode.dev/oauth/client.json")
    expect(body.redirect_uris).toEqual([
      "http://127.0.0.1/callback",
      "http://localhost/callback",
    ])
    expect(body.token_endpoint_auth_method).toBe("none")
  })

  it("serves a document per callback ID", async () => {
    const response = await get("AbCdEf-_1234")
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.client_id).toBe(
      "https://knightcode.dev/oauth/AbCdEf-_1234/client.json"
    )
    expect(body.redirect_uris).toEqual([
      "http://127.0.0.1/callback/AbCdEf-_1234",
      "http://localhost/callback/AbCdEf-_1234",
    ])
  })

  it("rejects anything that is not a callback ID", async () => {
    for (const id of ["abc123", "AbCdEfGhIjKlM", "AbCdEf.hIjKl"]) {
      expect((await get(id)).status).toBe(404)
    }
  })
})
