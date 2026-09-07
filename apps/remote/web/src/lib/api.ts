export interface Room {
	id: string;
	session_name: string | null;
	cwd: string | null;
	status: string;
	last_seen_at: number;
}

export class Unauthorized extends Error {}

export async function fetchRooms(signal?: AbortSignal): Promise<Room[]> {
	const response = await fetch("/api/rooms", { signal });
	if (response.status === 401) throw new Unauthorized("Not signed in");
	if (!response.ok) throw new Error(`Could not load sessions: ${response.status}`);
	const body = (await response.json()) as { rooms?: Room[] };
	return body.rooms ?? [];
}

export async function fetchCsrf(): Promise<string> {
	const response = await fetch("/api/csrf");
	if (!response.ok) throw new Unauthorized("Not signed in");
	const body = (await response.json()) as { csrf: string };
	return body.csrf;
}

/** "live" is what the relay writes while a host socket is attached; everything else is past tense. */
export function isLive(room: Room): boolean {
	return room.status === "live";
}

/**
 * The relay stores the working directory the terminal reported. Its last two segments are
 * what identifies a session at a glance — the full absolute path is noise on a phone.
 */
export function shortenPath(cwd: string | null): string | undefined {
	if (!cwd) return undefined;
	const parts = cwd.split(/[\\/]+/).filter(Boolean);
	return parts.slice(-2).join("/") || undefined;
}
