// apps/bots/test/auth.test.ts
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { claimHandle } from "../src/auth/handle.ts";
import { issueTicket, verifyTicket } from "../src/auth/tickets.ts";
import { followEmulatorConsent, sessionCookie } from "./helpers.ts";

describe("sign-in", () => {
	it("signs in with GitHub against the emulator and sets a session cookie", async () => {
		const start = await SELF.fetch("https://bots.knightcode.dev/auth/github?next=/", { redirect: "manual" });
		expect(start.status).toBe(302);
		const done = await followEmulatorConsent(start);
		expect(done.headers.get("set-cookie")).toMatch(/HttpOnly; Secure; SameSite=Lax/);
	});
	it("refuses state-changing requests from another origin", async () => {
		const response = await SELF.fetch("https://bots.knightcode.dev/api/bots", { method: "POST", headers: { origin: "https://evil.example", cookie: await sessionCookie() }, body: "{}" });
		expect(response.status).toBe(403);
	});
	it("validates handles", async () => {
		expect(await claimHandle(env.DB, "a1", "Raghav")).toBe("invalid");
		expect(await claimHandle(env.DB, "a1", "admin")).toBe("reserved");
		expect(await claimHandle(env.DB, "a1", "raghav")).toBe("ok");
		expect(await claimHandle(env.DB, "a2", "raghav")).toBe("taken");
	});
	it("expires tickets", async () => {
		const ticket = await issueTicket(env, { accountId: "a1", workspaceId: "w1", client: "desktop" }, "socket", 1);
		await new Promise((r) => setTimeout(r, 5));
		expect(await verifyTicket(env, ticket)).toBeUndefined();
	});
});
