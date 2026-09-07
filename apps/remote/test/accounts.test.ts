import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
	accountForCliToken,
	issueCliToken,
	issueSessionCookie,
	readSessionCookie,
	revokeCliToken,
	upsertAccount,
} from "../src/accounts.ts";

const SECRET = "test-secret";

beforeEach(async () => {
	await env.DB.exec("DELETE FROM cli_tokens");
	await env.DB.exec("DELETE FROM rooms");
	await env.DB.exec("DELETE FROM accounts");
});

describe("accounts", () => {
	it("creates an account once and returns the same id on repeat sign-in", async () => {
		const first = await upsertAccount(env.DB, "github", "42", "raghav", null);
		const second = await upsertAccount(env.DB, "github", "42", "raghav-renamed", null);
		expect(second.id).toBe(first.id);
		expect(second.login).toBe("raghav-renamed");
	});

	it("round-trips a session cookie and rejects a forged one", async () => {
		const cookie = await issueSessionCookie(SECRET, "account-1");
		const request = new Request("https://remote.knightcode.dev/", { headers: { cookie } });
		expect(await readSessionCookie(SECRET, request)).toBe("account-1");

		const forged = new Request("https://remote.knightcode.dev/", { headers: { cookie: "kc_session=account-2.bad" } });
		expect(await readSessionCookie(SECRET, forged)).toBeUndefined();
	});

	it("resolves a CLI token to its account and stops resolving once revoked", async () => {
		const account = await upsertAccount(env.DB, "github", "7", "owner", null);
		const token = await issueCliToken(env.DB, account.id, "laptop");
		expect(await accountForCliToken(env.DB, token)).toBe(account.id);

		await revokeCliToken(env.DB, token);
		expect(await accountForCliToken(env.DB, token)).toBeUndefined();
	});

	it("never stores the raw token", async () => {
		const account = await upsertAccount(env.DB, "github", "8", "owner", null);
		const token = await issueCliToken(env.DB, account.id, "laptop");
		const row = await env.DB.prepare("SELECT token_hash FROM cli_tokens").first<{ token_hash: string }>();
		expect(row?.token_hash).not.toBe(token);
	});
});
