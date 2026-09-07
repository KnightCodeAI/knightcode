import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { upsertAccount } from "../src/accounts.ts";
import { approveDevice, csrfToken, pollDevice, startDevice } from "../src/device.ts";

const ORIGIN = "https://remote.knightcode.dev";

beforeEach(async () => {
	await env.DB.exec("DELETE FROM device_codes");
	await env.DB.exec("DELETE FROM cli_tokens");
	await env.DB.exec("DELETE FROM accounts");
});

async function begin(): Promise<{ deviceCode: string; userCode: string }> {
	const response = await startDevice(env, new Request(`${ORIGIN}/auth/device`, { method: "POST" }));
	const body = (await response.json()) as { device_code: string; user_code: string };
	return { deviceCode: body.device_code, userCode: body.user_code };
}

function poll(deviceCode: string): Promise<Response> {
	return pollDevice(
		env,
		new Request(`${ORIGIN}/auth/device/token`, { method: "POST", body: JSON.stringify({ device_code: deviceCode }) }),
	);
}

function approve(userCode: string, csrf: string, accountId: string): Promise<Response> {
	return approveDevice(
		env,
		new Request(`${ORIGIN}/device`, { method: "POST", body: new URLSearchParams({ user_code: userCode, csrf }) }),
		accountId,
	);
}

describe("device flow", () => {
	it("offers a verification uri carrying the code, without approving on its own", async () => {
		const response = await startDevice(env, new Request(`${ORIGIN}/auth/device`, { method: "POST" }));
		const body = (await response.json()) as { user_code: string; verification_uri_complete: string };

		const complete = new URL(body.verification_uri_complete);
		expect(complete.pathname).toBe("/device");
		expect(complete.searchParams.get("code")).toBe(body.user_code);

		const row = await env.DB.prepare("SELECT approved_at FROM device_codes WHERE user_code = ?")
			.bind(body.user_code)
			.first<{ approved_at: number | null }>();
		expect(row?.approved_at).toBeNull();
	});

	it("sends an unusable code back to the form rather than a dead end", async () => {
		const account = await upsertAccount(env.DB, "github", "1", "owner", null);
		const response = await approve("ZZZZ-ZZZZ", await csrfToken(env, account.id), account.id);

		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe(`${ORIGIN}/device?invalid=1`);
	});

	it("returns pending until approved, then issues exactly one token", async () => {
		const account = await upsertAccount(env.DB, "github", "1", "owner", null);
		const { deviceCode, userCode } = await begin();

		const pending = await poll(deviceCode);
		expect(((await pending.json()) as { error: string }).error).toBe("authorization_pending");

		const approved = await approve(userCode, await csrfToken(env, account.id), account.id);
		expect(approved.status).toBe(303);
		expect(approved.headers.get("location")).toBe(`${ORIGIN}/device?approved=1`);

		const granted = await poll(deviceCode);
		expect(((await granted.json()) as { token: string }).token).toBeTruthy();

		const replay = await poll(deviceCode);
		expect(replay.status).toBe(400);
	});

	it("rejects an unknown device code", async () => {
		expect((await poll("nope")).status).toBe(400);
	});

	it("refuses approval carrying a bad csrf token, and sends the page back for a fresh one", async () => {
		const account = await upsertAccount(env.DB, "github", "2", "owner", null);
		const { userCode } = await begin();
		const response = await approve(userCode, "forged", account.id);
		expect(response.status).toBe(303);
		// Back to the form, not a plain-text dead end, and carrying the code so the retry is
		// one click once the reload has minted a token for the current account.
		expect(response.headers.get("location")).toBe(`${ORIGIN}/device?stale=1&code=${userCode}`);
		const row = await env.DB.prepare("SELECT approved_at FROM device_codes WHERE user_code = ?")
			.bind(userCode)
			.first<{ approved_at: number | null }>();
		expect(row?.approved_at).toBeNull();
	});

	it("refuses a csrf token minted for a different account", async () => {
		const owner = await upsertAccount(env.DB, "github", "3", "owner", null);
		const other = await upsertAccount(env.DB, "github", "4", "other", null);
		const { userCode } = await begin();
		const response = await approve(userCode, await csrfToken(env, other.id), owner.id);
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toContain("stale=1");
		const row = await env.DB.prepare("SELECT account_id FROM device_codes WHERE user_code = ?")
			.bind(userCode)
			.first<{ account_id: string | null }>();
		expect(row?.account_id).toBeNull();
	});
});
