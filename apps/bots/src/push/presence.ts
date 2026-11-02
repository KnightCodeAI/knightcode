// Presence and held pushes (spec section 15): while the user is active in the desktop or web app, pushes wait; once
// they are away, everything held goes out as one push. Each bot notifies when it finishes, when it needs input, or
// never; the body carries only the preview the user allowed.
import type { PushPayload, PushSubscription } from "./web-push.ts";

/** How long one sign of activity keeps the user "active". */
export const ACTIVE_MS = 60_000;
const PREVIEW_CHARS = 80;

export type NotifyLevel = "finish" | "input" | "never";

export interface Notice {
	botId: string;
	botName: string;
	kind: "finish" | "input";
	level: NotifyLevel;
	/** The text a preview would show (a reply, or what the bot needs). */
	text?: string;
}

export function createPushTables(sql: SqlStorage): void {
	sql.exec("CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at INTEGER NOT NULL)");
	sql.exec("CREATE TABLE IF NOT EXISTS held_pushes (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT, path TEXT, tag TEXT)");
}

const meta = (sql: SqlStorage, key: string) => sql.exec<{ value: string }>("SELECT value FROM user_meta WHERE key = ?", key).toArray()[0]?.value;
const setMeta = (sql: SqlStorage, key: string, value: string) => sql.exec("INSERT OR REPLACE INTO user_meta (key, value) VALUES (?, ?)", key, value);

export const activeUntil = (sql: SqlStorage) => Number(meta(sql, "active_until") ?? 0);
export const isActive = (sql: SqlStorage, now: number) => activeUntil(sql) > now;

/** Records activity (or that the user left); returns when the user turns away if nothing else happens. */
export function markPresence(sql: SqlStorage, active: boolean, now: number): number {
	const until = active ? now + ACTIVE_MS : 0;
	setMeta(sql, "active_until", String(until));
	return until;
}

export const previewsAllowed = (sql: SqlStorage) => meta(sql, "push_preview") === "on";
export const setPreviewsAllowed = (sql: SqlStorage, allowed: boolean) => setMeta(sql, "push_preview", allowed ? "on" : "off");

/** The push a notice becomes, or nothing when the bot's setting says not to notify. */
export function pushFor(notice: Notice, previews: boolean): PushPayload | undefined {
	if (notice.level === "never" || (notice.level === "input" && notice.kind !== "input")) return undefined;
	const fallback = notice.kind === "input" ? "Needs your input" : "Finished";
	const text = previews && notice.text ? notice.text.replace(/\s+/g, " ").trim() : "";
	const body = text ? (text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS - 1)}…` : text) : fallback;
	return { title: notice.botName, body, path: `/bots/${encodeURIComponent(notice.botId)}`, tag: notice.botId };
}

export function hold(sql: SqlStorage, push: PushPayload): void {
	sql.exec("INSERT INTO held_pushes (title, body, path, tag) VALUES (?, ?, ?, ?)", push.title, push.body ?? null, push.path ?? null, push.tag ?? null);
}

/** Everything held, as one push (and the queue emptied); nothing when nothing is held. */
export function takeHeld(sql: SqlStorage): PushPayload | undefined {
	const rows = sql.exec<{ title: string; body: string | null; path: string | null; tag: string | null }>("SELECT title, body, path, tag FROM held_pushes ORDER BY id").toArray();
	sql.exec("DELETE FROM held_pushes");
	if (rows.length === 0) return undefined;
	if (rows.length === 1) {
		const [row] = rows;
		return { title: row!.title, ...(row!.body ? { body: row!.body } : {}), ...(row!.path ? { path: row!.path } : {}), ...(row!.tag ? { tag: row!.tag } : {}) };
	}
	const bots = new Set(rows.map((row) => row.title));
	return { title: "KnightCode Bots", body: `${rows.length} updates from ${bots.size === 1 ? [...bots][0] : `${bots.size} bots`}`, path: "/inbox", tag: "held" };
}

export function addSubscription(sql: SqlStorage, subscription: PushSubscription, now = Date.now()): void {
	const url = new URL(subscription.endpoint);
	if (url.protocol !== "https:") throw new Error("a push endpoint is https");
	if (!subscription.keys?.p256dh || !subscription.keys?.auth) throw new Error("a push subscription has keys");
	sql.exec(
		"INSERT OR REPLACE INTO push_subscriptions (endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?)",
		subscription.endpoint,
		subscription.keys.p256dh,
		subscription.keys.auth,
		now,
	);
}

export const removeSubscription = (sql: SqlStorage, endpoint: string) => void sql.exec("DELETE FROM push_subscriptions WHERE endpoint = ?", endpoint);

export const subscriptions = (sql: SqlStorage): PushSubscription[] =>
	sql
		.exec<{ endpoint: string; p256dh: string; auth: string }>("SELECT endpoint, p256dh, auth FROM push_subscriptions")
		.toArray()
		.map((row) => ({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }));
