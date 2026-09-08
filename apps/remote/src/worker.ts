import { accountForCliToken, clearSessionCookie, type Env, readSessionCookie, revokeCliToken } from "./accounts.ts";
import { approveDevice, csrfToken, pollDevice, startDevice } from "./device.ts";
import { completeLogin, startLogin } from "./oauth.ts";

export { RemoteRoom } from "./room.ts";

/**
 * Room ids are minted by the CLI (see packages/remote/src/host.ts), so they are attacker
 * controlled until validated here. The id becomes a Durable Object name and a D1 primary
 * key, so anything outside this shape is refused before it reaches either.
 */
const ROOM_ID = /^[0-9A-F]{32}$/;
const ROOM_PATH = /^\/r\/([0-9A-F]{32})(\/ws)?$/;
const API_ROOM_PATH = /^\/api\/rooms\/([0-9A-F]{32})$/;

function bearer(request: Request): string | undefined {
	const header = request.headers.get("authorization");
	return header?.startsWith("Bearer ") ? header.slice(7) : undefined;
}

/**
 * The session cookie is only a signature over an account id, so a valid cookie can still
 * name a row that is gone — a deleted account, a wiped dev database. Checking the row here,
 * where the cookie becomes an identity, makes that case behave exactly like signed out for
 * every route below. Without it /device wrote a device_codes.account_id with no account
 * behind it and D1 rejected the whole approval with a foreign key error.
 */
async function currentAccount(env: Env, request: Request): Promise<string | undefined> {
	const accountId = await readSessionCookie(env.SIGNING_SECRET, request);
	if (!accountId) return undefined;
	const row = await env.DB.prepare("SELECT id FROM accounts WHERE id = ?").bind(accountId).first<{ id: string }>();
	return row ? accountId : undefined;
}

/** The one built page. Every app route resolves to it; the app reads the path itself. */
function appShell(env: Env, url: URL, request: Request): Promise<Response> {
	return env.ASSETS.fetch(new Request(`${url.origin}/index.html`, request));
}

function roomStub(env: Env, roomId: string): DurableObjectStub {
	return env.ROOM.get(env.ROOM.idFromName(roomId));
}

async function hostConnect(env: Env, request: Request): Promise<Response> {
	const url = new URL(request.url);
	const roomId = url.searchParams.get("room") ?? "";
	if (!ROOM_ID.test(roomId)) return new Response("Bad room id", { status: 400 });

	const token = bearer(request);
	const accountId = token ? await accountForCliToken(env.DB, token) : undefined;
	if (!accountId) return new Response("Unauthorized", { status: 401 });

	const now = Date.now();
	await env.DB.prepare(
		`INSERT INTO rooms (id, account_id, session_name, cwd, created_at, last_seen_at, status)
		 VALUES (?, ?, ?, ?, ?, ?, 'live')
		 ON CONFLICT (id) DO UPDATE SET last_seen_at = excluded.last_seen_at, status = 'live'`,
	)
		.bind(roomId, accountId, url.searchParams.get("name"), url.searchParams.get("cwd"), now, now)
		.run();

	return roomStub(env, roomId).fetch("https://room/ws", {
		headers: { upgrade: "websocket", "x-kc-role": "host", "x-kc-account": accountId, "x-kc-room": roomId },
	});
}

async function ownsRoom(env: Env, roomId: string, accountId: string): Promise<boolean> {
	const row = await env.DB.prepare("SELECT account_id FROM rooms WHERE id = ?")
		.bind(roomId)
		.first<{ account_id: string }>();
	return row?.account_id === accountId;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		if (path === "/host") return hostConnect(env, request);
		if (path === "/host/stop" && request.method === "POST") {
			const token = bearer(request);
			const owner = token ? await accountForCliToken(env.DB, token) : undefined;
			const roomId = url.searchParams.get("room") ?? "";
			if (!owner || !ROOM_ID.test(roomId) || !(await ownsRoom(env, roomId, owner))) {
				return new Response("Unauthorized", { status: 401 });
			}
			await roomStub(env, roomId).fetch("https://room/delete", { headers: { "x-kc-account": owner } });
			await env.DB.prepare("DELETE FROM rooms WHERE id = ?").bind(roomId).run();
			return new Response(null, { status: 204 });
		}
		if (path === "/login") return startLogin(env, url);
		if (path === "/auth/callback") return completeLogin(env, url);
		if (path === "/auth/device" && request.method === "POST") return startDevice(env, request);
		if (path === "/auth/device/token" && request.method === "POST") return pollDevice(env, request);
		if (path === "/auth/revoke" && request.method === "POST") {
			// Holding the token is the authorisation: /remote logout revokes its own credential.
			const token = bearer(request);
			if (token) await revokeCliToken(env.DB, token);
			return new Response(null, { status: 204 });
		}

		const accountId = await currentAccount(env, request);

		if (path === "/logout") {
			return new Response(null, { status: 302, headers: { location: "/", "set-cookie": clearSessionCookie() } });
		}

		if (path === "/device") {
			// pathname + search, not a literal "/device": signing in is the common first
			// run, and a bare path would drop the prefilled code on the way through GitHub.
			if (!accountId) {
				return Response.redirect(`${url.origin}/login?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
			}
			if (request.method === "POST") return approveDevice(env, request, accountId);
			return appShell(env, url, request);
		}
		if (path === "/api/csrf") {
			if (!accountId) return new Response("Unauthorized", { status: 401 });
			return Response.json({ csrf: await csrfToken(env, accountId) });
		}

		if (path === "/api/me") {
			if (!accountId) return new Response("Unauthorized", { status: 401 });
			const row = await env.DB.prepare("SELECT login, avatar_url FROM accounts WHERE id = ?")
				.bind(accountId)
				.first<{ login: string; avatar_url: string | null }>();
			return Response.json({ login: row?.login ?? "", avatarUrl: row?.avatar_url ?? null });
		}

		if (path === "/api/rooms") {
			if (!accountId) return new Response("Unauthorized", { status: 401 });
			const rows = await env.DB.prepare(
				"SELECT id, session_name, cwd, status, busy, last_seen_at FROM rooms WHERE account_id = ? ORDER BY last_seen_at DESC",
			)
				.bind(accountId)
				.all<{
					id: string;
					session_name: string | null;
					cwd: string | null;
					status: string;
					busy: number;
					last_seen_at: number;
				}>();
			return Response.json({ rooms: rows.results ?? [] });
		}

		const apiRoom = API_ROOM_PATH.exec(path);
		if (apiRoom?.[1] && request.method === "DELETE") {
			// Same effect as /remote stop, from the web. The cookie is SameSite=Lax, which no
			// cross-site DELETE can carry, so ownership is the whole check.
			const roomId = apiRoom[1];
			if (!accountId) return new Response("Unauthorized", { status: 401 });
			if (!(await ownsRoom(env, roomId, accountId))) return new Response("Forbidden", { status: 403 });
			await roomStub(env, roomId).fetch("https://room/delete", { headers: { "x-kc-account": accountId } });
			await env.DB.prepare("DELETE FROM rooms WHERE id = ?").bind(roomId).run();
			return new Response(null, { status: 204 });
		}

		const roomMatch = ROOM_PATH.exec(path);
		if (roomMatch) {
			const [, roomId, isSocket] = roomMatch;
			if (!accountId) {
				return Response.redirect(`${url.origin}/login?next=${encodeURIComponent(`/r/${roomId}`)}`, 302);
			}
			if (!(await ownsRoom(env, roomId, accountId))) return new Response("Forbidden", { status: 403 });
			if (isSocket) {
				return roomStub(env, roomId).fetch("https://room/ws", {
					headers: { upgrade: "websocket", "x-kc-role": "viewer", "x-kc-account": accountId },
				});
			}
			return appShell(env, url, request);
		}

		// Signed in or not, "/" is the same shell: the app asks /api/rooms and renders the
		// session list or the sign-in page from the answer. Every route that actually exposes
		// data is authorised above, so serving the shell to an anonymous visitor reveals none.
		if (path === "/") return appShell(env, url, request);

		return env.ASSETS.fetch(request);
	},
};
