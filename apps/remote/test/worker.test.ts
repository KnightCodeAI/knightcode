import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { CLOSE_UNAUTHORIZED } from "../../../packages/remote/src/protocol.ts";
import { issueCliToken, issueSessionCookie, upsertAccount } from "../src/accounts.ts";

const MINE = "A".repeat(32);
const THEIRS = "B".repeat(32);

beforeEach(async () => {
	await env.DB.exec("DELETE FROM rooms");
	await env.DB.exec("DELETE FROM cli_tokens");
	await env.DB.exec("DELETE FROM accounts");
});

async function room(id: string, accountId: string, name?: string): Promise<void> {
	await env.DB.prepare(
		"INSERT INTO rooms (id, account_id, session_name, created_at, last_seen_at, status) VALUES (?, ?, ?, ?, ?, 'live')",
	)
		.bind(id, accountId, name ?? null, Date.now(), Date.now())
		.run();
}

describe("authorisation boundary", () => {
	it("redirects an anonymous viewer to login", async () => {
		const response = await SELF.fetch(`https://remote.knightcode.dev/r/${MINE}`, { redirect: "manual" });
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toContain(`/login?next=%2Fr%2F${MINE}`);
	});

	it("carries the prefilled code through the login redirect", async () => {
		const response = await SELF.fetch(`https://remote.knightcode.dev/device?code=ABCD-1234`, { redirect: "manual" });
		expect(response.status).toBe(302);
		// Losing the query here would send every first-run user to an empty form.
		expect(response.headers.get("location")).toContain(`/login?next=${encodeURIComponent("/device?code=ABCD-1234")}`);
	});

	it("treats a cookie naming an account that no longer exists as signed out", async () => {
		// A wiped database leaves valid signatures over ids with no row behind them. Trusting
		// one made /device write device_codes.account_id against nothing, and D1 answered the
		// approval with a foreign key error instead of a login.
		const account = await upsertAccount(env.DB, "github", "9", "gone", null);
		const cookie = await issueSessionCookie(env.SIGNING_SECRET, account.id);
		await env.DB.prepare("DELETE FROM accounts WHERE id = ?").bind(account.id).run();

		const page = await SELF.fetch("https://remote.knightcode.dev/device?code=ABCD-1234", {
			headers: { cookie: cookie.split(";")[0] },
			redirect: "manual",
		});
		expect(page.status).toBe(302);
		expect(page.headers.get("location")).toContain("/login");

		const rooms = await SELF.fetch("https://remote.knightcode.dev/api/rooms", {
			headers: { cookie: cookie.split(";")[0] },
		});
		expect(rooms.status).toBe(401);
	});

	it("refuses a viewer whose account does not own the room", async () => {
		const owner = await upsertAccount(env.DB, "github", "1", "owner", null);
		const other = await upsertAccount(env.DB, "github", "2", "other", null);
		await room(MINE, owner.id);

		const cookie = await issueSessionCookie(env.SIGNING_SECRET, other.id);
		const response = await SELF.fetch(`https://remote.knightcode.dev/r/${MINE}`, {
			headers: { cookie: cookie.split(";")[0] },
			redirect: "manual",
		});
		expect(response.status).toBe(403);
	});

	it("closes a host connection presenting a revoked token with the code the CLI stops on", async () => {
		const account = await upsertAccount(env.DB, "github", "3", "owner", null);
		const token = await issueCliToken(env.DB, account.id, "laptop");
		await env.DB.prepare("UPDATE cli_tokens SET revoked_at = ?").bind(Date.now()).run();

		const response = await SELF.fetch(`https://remote.knightcode.dev/host?room=${MINE}`, {
			headers: { upgrade: "websocket", authorization: `Bearer ${token}` },
		});
		// A plain 401 reached the CLI as a bare socket error, which it retried forever.
		const socket = response.webSocket;
		if (!socket) throw new Error("expected a websocket");
		const closed = new Promise<number>((resolve) => socket.addEventListener("close", (event) => resolve(event.code)));
		socket.accept();
		expect(await closed).toBe(CLOSE_UNAUTHORIZED);
		expect(await env.DB.prepare("SELECT id FROM rooms WHERE id = ?").bind(MINE).first()).toBeNull();
	});

	it("refuses a host connection to another account's room without touching its row", async () => {
		const owner = await upsertAccount(env.DB, "github", "15", "owner", null);
		const other = await upsertAccount(env.DB, "github", "16", "other", null);
		await room(MINE, owner.id, "mine");
		const token = await issueCliToken(env.DB, other.id, "laptop");

		const response = await SELF.fetch(`https://remote.knightcode.dev/host?room=${MINE}&name=spoofed&cwd=/spoofed`, {
			headers: { upgrade: "websocket", authorization: `Bearer ${token}` },
		});
		expect(response.status).toBe(403);
		const row = await env.DB.prepare("SELECT account_id, session_name, cwd FROM rooms WHERE id = ?").bind(MINE).first();
		expect(row).toEqual({ account_id: owner.id, session_name: "mine", cwd: null });
	});

	it("signs out only on a POST that carried the session", async () => {
		const account = await upsertAccount(env.DB, "github", "17", "owner", null);
		const cookie = (await issueSessionCookie(env.SIGNING_SECRET, account.id)).split(";")[0];
		const logout = (init: RequestInit): Promise<Response> =>
			SELF.fetch("https://remote.knightcode.dev/logout", { ...init, redirect: "manual" });

		// A cross-site form cannot send the SameSite=Lax cookie, and a prefetch or link preview only GETs.
		expect((await logout({ method: "POST" })).headers.get("set-cookie")).toBeNull();
		expect((await logout({ headers: { cookie } })).headers.get("set-cookie")).toBeNull();
		const signedOut = await logout({ method: "POST", headers: { cookie } });
		expect(signedOut.status).toBe(303);
		expect(signedOut.headers.get("set-cookie")).toContain("kc_session=;");
	});

	it("refreshes a room's name and folder when its host reconnects", async () => {
		// /remote toggled back on after /resume publishes a different session under the same
		// room id; the list must follow, not keep the first name it ever saw.
		const account = await upsertAccount(env.DB, "github", "7", "owner", null);
		const token = await issueCliToken(env.DB, account.id, "laptop");
		const connect = (name: string, cwd: string): Promise<Response> =>
			SELF.fetch(`https://remote.knightcode.dev/host?room=${MINE}&name=${name}&cwd=${encodeURIComponent(cwd)}`, {
				headers: { upgrade: "websocket", authorization: `Bearer ${token}` },
			});
		expect((await connect("first", "/one")).status).toBe(101);
		expect((await connect("second", "/two")).status).toBe(101);

		const cookie = await issueSessionCookie(env.SIGNING_SECRET, account.id);
		const response = await SELF.fetch("https://remote.knightcode.dev/api/rooms", {
			headers: { cookie: cookie.split(";")[0] },
		});
		const body = (await response.json()) as { rooms: Array<{ session_name: string; cwd: string }> };
		expect(body.rooms[0]).toMatchObject({ session_name: "second", cwd: "/two" });
	});

	it("lists only the signed-in account's rooms", async () => {
		const owner = await upsertAccount(env.DB, "github", "4", "owner", null);
		const other = await upsertAccount(env.DB, "github", "5", "other", null);
		await room(MINE, owner.id, "my session");
		await room(THEIRS, other.id, "their session");

		const cookie = await issueSessionCookie(env.SIGNING_SECRET, owner.id);
		const response = await SELF.fetch("https://remote.knightcode.dev/api/rooms", {
			headers: { cookie: cookie.split(";")[0] },
		});
		const body = (await response.json()) as { rooms: Array<{ id: string }> };
		expect(body.rooms.map((entry) => entry.id)).toEqual([MINE]);
	});

	it("refuses a host connection whose room id is not a well-formed room id", async () => {
		const account = await upsertAccount(env.DB, "github", "6", "owner", null);
		const token = await issueCliToken(env.DB, account.id, "laptop");
		const response = await SELF.fetch("https://remote.knightcode.dev/host?room=../../etc", {
			headers: { upgrade: "websocket", authorization: `Bearer ${token}` },
		});
		expect(response.status).toBe(400);
	});

	it("lets only the owner delete a room from the web", async () => {
		const owner = await upsertAccount(env.DB, "github", "12", "owner", null);
		const other = await upsertAccount(env.DB, "github", "13", "other", null);
		await room(MINE, owner.id);

		const otherCookie = await issueSessionCookie(env.SIGNING_SECRET, other.id);
		const forbidden = await SELF.fetch(`https://remote.knightcode.dev/api/rooms/${MINE}`, {
			method: "DELETE",
			headers: { cookie: otherCookie.split(";")[0] },
		});
		expect(forbidden.status).toBe(403);
		expect(await env.DB.prepare("SELECT id FROM rooms WHERE id = ?").bind(MINE).first()).not.toBeNull();

		const ownerCookie = await issueSessionCookie(env.SIGNING_SECRET, owner.id);
		const allowed = await SELF.fetch(`https://remote.knightcode.dev/api/rooms/${MINE}`, {
			method: "DELETE",
			headers: { cookie: ownerCookie.split(";")[0] },
		});
		expect(allowed.status).toBe(204);
		expect(await env.DB.prepare("SELECT id FROM rooms WHERE id = ?").bind(MINE).first()).toBeNull();
	});

	it("describes the signed-in account and nobody else", async () => {
		expect((await SELF.fetch("https://remote.knightcode.dev/api/me")).status).toBe(401);

		const account = await upsertAccount(env.DB, "github", "14", "octocat", "https://avatars/octocat.png");
		const cookie = await issueSessionCookie(env.SIGNING_SECRET, account.id);
		const response = await SELF.fetch("https://remote.knightcode.dev/api/me", {
			headers: { cookie: cookie.split(";")[0] },
		});
		expect(await response.json()).toEqual({ login: "octocat", avatarUrl: "https://avatars/octocat.png" });
	});

	it("refuses to stop a room owned by another account", async () => {
		const owner = await upsertAccount(env.DB, "github", "7", "owner", null);
		const other = await upsertAccount(env.DB, "github", "8", "other", null);
		await room(MINE, owner.id);
		const token = await issueCliToken(env.DB, other.id, "laptop");

		const response = await SELF.fetch(`https://remote.knightcode.dev/host/stop?room=${MINE}`, {
			method: "POST",
			headers: { authorization: `Bearer ${token}` },
		});
		expect(response.status).toBe(401);
		const survived = await env.DB.prepare("SELECT id FROM rooms WHERE id = ?").bind(MINE).first();
		expect(survived).not.toBeNull();
	});
});
