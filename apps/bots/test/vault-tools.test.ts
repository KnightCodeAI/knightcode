// apps/bots/test/vault-tools.test.ts
import type { VaultItem } from "@knightcode/bots-protocol";
import { afterEach, expect, it } from "vitest";
import { FakeOnePassword, onePasswordFor } from "../src/vault/onepassword.ts";
import { encodings, SCRUBBED, scrub, vaultTools } from "../src/vault/tools.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

const SECRET = "sk_live_Sup3r-Secret/Value+42";

/** A target API that echoes the credential back in every encoding it can think of. */
function echoServer() {
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input instanceof Request ? input.url : input);
		if (url.startsWith("https://cloudflare-dns.com/")) return Response.json({ Answer: [{ type: 1, data: "93.184.216.34" }] });
		const auth = new Headers(init?.headers).get("authorization") ?? "";
		const value = auth.replace(/^Bearer /, "");
		const bytes = new TextEncoder().encode(value);
		const b64 = btoa(String.fromCharCode(...bytes));
		const body = JSON.stringify({
			plain: value,
			base64: b64,
			base64url: b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
			urlencoded: encodeURIComponent(value),
			hex: [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""),
			header: auth,
		});
		return new Response(body, { headers: { "content-type": "application/json", "x-echo": value } });
	}) as typeof fetch;
}

const item: VaultItem = { id: "v1", kind: "api", name: "billing", origin: "https://api.example.com", injection: "bearer", createdAt: 0 };
const vault = (reveals: string[] = []) => ({
	list: async () => [item],
	reveal: async () => {
		reveals.push("v1");
		return SECRET;
	},
	forget: async () => {},
	request: async () => {},
});
const run = async (args: Record<string, unknown>, access = vault()) => {
	const tool = vaultTools(access).find((candidate) => candidate.name === "call_with_secret")!;
	const result = (await tool.execute(args as never, undefined as never, undefined as never)) as { output: { text: string }[]; isError?: boolean };
	return { text: result.output[0]!.text, isError: result.isError ?? false };
};

it("never returns a secret the target echoes, in any encoding", async () => {
	echoServer();
	const result = await run({ name: "billing", url: "https://api.example.com/v1/me" });
	expect(result.isError).toBe(false);
	for (const form of encodings(SECRET)) expect(result.text).not.toContain(form);
	expect(result.text).toContain(SCRUBBED);
	expect(result.text).toContain("HTTP 200");
});

it("never sends a credential to another origin or over plain HTTP", async () => {
	echoServer();
	const reveals: string[] = [];
	expect((await run({ name: "billing", url: "https://evil.example/collect" }, vault(reveals))).text).toMatch(/never sent anywhere else/);
	expect((await run({ name: "billing", url: "http://api.example.com/v1/me" }, vault(reveals))).isError).toBe(true);
	// Refused before the value was ever revealed.
	expect(reveals).toEqual([]);
	expect((await run({ name: "unknown", url: "https://api.example.com/" })).text).toMatch(/request_secret/);
});

it("scrubs Basic credentials and their parts", () => {
	const scrubbed = scrub(`Authorization: Basic ${btoa("ada:hunter2-long")} user ada pass hunter2-long`, ["ada:hunter2-long", "hunter2-long"]);
	expect(scrubbed).not.toMatch(/hunter2-long|YWRhOmh1bnRlcjItbG9uZw/);
});

it("lets 1Password fill only after the owner approves on their device, and the agent route stays off until it is built", async () => {
	const onePassword = new FakeOnePassword({ "https://shop.example": "approved" }, ["acct-1"]);
	expect(await onePassword.requestFill({ accountId: "acct-1", origin: "https://shop.example", field: "password" })).toBe("approved");
	expect(await onePassword.requestFill({ accountId: "acct-1", origin: "https://bank.example", field: "password" })).toBe("pending");
	expect(await onePassword.requestFill({ accountId: "acct-2", origin: "https://shop.example", field: "password" })).toBe("unavailable");
	expect(() => onePasswordFor({ ONEPASSWORD_AGENT_SIGNIN: "on" })).toThrow(/not built yet/);
	expect(await onePasswordFor({}).requestFill({ accountId: "a", origin: "o", field: "password", botName: "b" })).toBe("unavailable");
});
