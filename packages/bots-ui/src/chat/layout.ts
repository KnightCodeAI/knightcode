// How a thread's entries are laid out: a day stamp before each new day, and runs of messages from one speaker
// grouped so their bubbles join.
import type { Entry } from "@knightcode/bots-protocol";

export type Place = "single" | "first" | "middle" | "last";

export type Row = { kind: "day"; key: string; at: number } | { kind: "entry"; key: string; entry: Entry; place: Place };

/** The rows to render for `entries`, in order. */
export function layoutEntries(entries: readonly Entry[], timeZone?: string): Row[] {
	const dayOf = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
	const rows: Row[] = [];
	let lastDay = "";
	for (const [index, entry] of entries.entries()) {
		const day = dayOf.format(entry.createdAt);
		if (day !== lastDay) {
			rows.push({ kind: "day", key: `day-${entry.id}`, at: entry.createdAt });
			lastDay = day;
		}
		const joinsPrevious =
			index > 0 && sameSpeaker(entries[index - 1]!, entry) && dayOf.format(entries[index - 1]!.createdAt) === day;
		const joinsNext =
			index < entries.length - 1 &&
			sameSpeaker(entry, entries[index + 1]!) &&
			dayOf.format(entries[index + 1]!.createdAt) === day;
		const place: Place = joinsPrevious ? (joinsNext ? "middle" : "last") : joinsNext ? "first" : "single";
		rows.push({ kind: "entry", key: entry.id, entry, place });
	}
	return rows;
}

function sameSpeaker(a: Entry, b: Entry): boolean {
	return a.kind === "message" && b.kind === "message" && a.role === b.role && a.botId === b.botId;
}

/** "Sun, Oct 18 8:55 AM". */
export function formatDay(at: number, timeZone?: string): string {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		weekday: "short",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	}).formatToParts(at);
	const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
	return `${get("weekday")}, ${get("month")} ${get("day")} ${get("hour")}:${get("minute")} ${get("dayPeriod")}`;
}

/** "8:55 AM". */
export function formatTime(at: number, timeZone?: string): string {
	return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(at);
}
