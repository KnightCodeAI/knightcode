import type { DiffFile } from "@knightcode/app-server-protocol";

export function duration(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${s % 60}s`;
	return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export const basename = (path: string) =>
	path
		.replace(/[\\/]+$/, "")
		.split(/[\\/]/)
		.pop() || path;

export function samePath(a: string, b: string): boolean {
	const norm = (p: string) => p.replace(/[\\/]+$/, "").replaceAll("\\", "/");
	return window.knightcode.platform === "win32" ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
}

/** A dropped file as an `@` mention: relative to the project when inside it, as `@` search inserts them, else absolute. */
export function mentionPath(path: string, cwd: string | undefined): string {
	const root = cwd?.replace(/[\\/]+$/, "");
	if (!root || path.length <= root.length + 1 || !/[\\/]/.test(path[root.length]!)) return path;
	return samePath(path.slice(0, root.length), root) ? path.slice(root.length + 1) : path;
}

export const tokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

const sameDay = (a: Date, b: Date) =>
	a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "10:28 AM". */
export const clockTime = (ms: number) =>
	new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** The day a separator names, as Codex: "Today", "Yesterday", a weekday within the week, else the date. */
export function dayLabel(ms: number, now = Date.now()): string {
	const date = new Date(ms);
	const today = new Date(now);
	// Calendar days, not elapsed time: a week ago at a later hour is not "this Monday", and DST days are 23 or 25 hours.
	const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	const days = Math.round((midnight(today) - midnight(date)) / 86_400_000);
	if (days === 0) return "Today";
	if (days === 1) return "Yesterday";
	if (days > 1 && days < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
	return date.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
	});
}

/** A message's time under it: the clock today, the weekday or date and the clock before that (Codex's). */
export function messageTime(ms: number, now = Date.now()): string {
	if (sameDay(new Date(ms), new Date(now))) return clockTime(ms);
	const day = dayLabel(ms, now);
	return `${day === "Yesterday" ? new Date(ms).toLocaleDateString(undefined, { weekday: "long" }) : day} ${clockTime(ms)}`;
}

/** Turns an hour or more apart get a date separator between them (Codex's "Yesterday 11:53 AM"). */
export const SEPARATOR_GAP_MS = 3_600_000;

/** Where `query` occurs in `text`, case-insensitively, as start offsets (no overlaps). */
export function matchOffsets(text: string, query: string): number[] {
	const needle = query.toLowerCase();
	if (!needle) return [];
	const haystack = text.toLowerCase();
	const offsets: number[] = [];
	if (haystack.length === text.length) {
		for (let i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + needle.length)) offsets.push(i);
		return offsets;
	}
	// Lowercasing changed the length ("İ" becomes two code units): compare at the original text's own offsets.
	for (let i = 0; i + query.length <= text.length; i++)
		if (text.slice(i, i + query.length).toLowerCase() === needle) {
			offsets.push(i);
			i += query.length - 1;
		}
	return offsets;
}

/**
 * Whether a diff is too large to render whole, by Codex's limits: more than 128 files, 9,000 changed lines or 12 MiB of
 * changed text. The Changes pane then shows one file at a time.
 */
const utf8 = new TextEncoder();

export function isLargeDiff(files: DiffFile[]): boolean {
	if (files.length > 128) return true;
	let lines = 0;
	let bytes = 0;
	for (const file of files) {
		lines += file.additions + file.deletions;
		// UTF-8 bytes, as the limit is: an emoji is 4 bytes but 2 UTF-16 units.
		for (const hunk of file.hunks)
			for (const line of hunk.lines) if (line[0] === "+" || line[0] === "-") bytes += utf8.encode(line).length - 1;
	}
	return lines > 9_000 || bytes > 12 * 1024 * 1024;
}

/** The body of the last fenced code block (``` or ~~~, as CommonMark fences them) across Markdown texts, in order. */
export function lastCodeBlock(texts: string[]): string | undefined {
	let last: string | undefined;
	for (const text of texts) {
		// A line scan, as CommonMark: a closing fence of the same character at least as long as the opener, CRLF
		// lines, and an unclosed fence running to the end of the text.
		let open: { fence: string; body: string[] } | undefined;
		for (const line of text.split(/\r?\n/)) {
			if (!open) {
				const opener = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
				if (opener) open = { fence: opener, body: [] };
				continue;
			}
			const closer = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)?.[1];
			if (closer && closer[0] === open.fence[0] && closer.length >= open.fence.length) {
				last = open.body.join("\n");
				open = undefined;
			} else open.body.push(line);
		}
		if (open) last = open.body.join("\n");
	}
	return last;
}
