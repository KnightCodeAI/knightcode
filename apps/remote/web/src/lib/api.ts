export interface Room {
	id: string;
	session_name: string | null;
	cwd: string | null;
	status: string;
	busy: number;
	last_seen_at: number;
}

export interface Me {
	login: string;
	avatarUrl: string | null;
}

/** working: a terminal is attached and a turn is running. live: attached, idle. offline: nobody home. */
export type SessionState = "working" | "live" | "offline";

export class Unauthorized extends Error {}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(path, init);
	if (response.status === 401) throw new Unauthorized("Not signed in");
	if (!response.ok) throw new Error(`${path} answered ${response.status}`);
	return (await response.json()) as T;
}

export async function fetchRooms(signal?: AbortSignal): Promise<Room[]> {
	const body = await json<{ rooms?: Room[] }>("/api/rooms", { signal });
	return body.rooms ?? [];
}

export function fetchMe(): Promise<Me> {
	return json<Me>("/api/me");
}

export async function fetchCsrf(): Promise<string> {
	const body = await json<{ csrf: string }>("/api/csrf");
	return body.csrf;
}

export async function deleteRoom(id: string): Promise<void> {
	const response = await fetch(`/api/rooms/${id}`, { method: "DELETE" });
	if (!response.ok && response.status !== 204) throw new Error(`Could not delete: ${response.status}`);
}

/** "live" is what the relay writes while a host socket is attached; everything else is past tense. */
export function stateOf(room: Room): SessionState {
	if (room.status !== "live") return "offline";
	return room.busy ? "working" : "live";
}

/**
 * The relay stores the working directory the terminal reported. Its last two segments are
 * what identifies a session at a glance — the full absolute path is noise on a phone.
 */
export function shortenPath(cwd: string | null | undefined): string | undefined {
	if (!cwd) return undefined;
	const parts = cwd.split(/[\\/]+/).filter(Boolean);
	return parts.slice(-2).join("/") || undefined;
}

export interface BugReport {
	id: string;
	created_at: number;
	client_id: string | null;
	version: string | null;
	platform: string | null;
	arch: string | null;
	runtime: string | null;
	description: string | null;
	has_session: number;
	has_summary: number;
	crash_count: number;
	size_bytes: number;
}

/**
 * Maintainer-only, and the Worker answers 404 rather than 401 for everyone else, so this
 * throws a plain Error on refusal. There is no signed-out state to render: a visitor who
 * cannot read reports should not learn the page exists.
 */
export async function fetchBugReports(signal?: AbortSignal): Promise<BugReport[]> {
	const body = await json<{ reports?: BugReport[] }>("/api/bugs", { signal });
	return body.reports ?? [];
}

export function bugReportFileUrl(id: string, file: string): string {
	return `/api/bugs/${id}/${file}`;
}

/** Bundles run from a few KB to the 10 MB cap, so both units earn their place. */
export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
