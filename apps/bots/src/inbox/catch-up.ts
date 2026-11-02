// Catch-up (spec section 20): when the user returns after at least 4 hours with no activity in any app, the first
// screen shows "While you were away": what finished, what waits and what failed across all bots, each linking to its
// place. The user's helper model writes it, and only when something happened: with nothing to say, no model is called.
import type { Helper } from "../memory/recall.ts";

export const AWAY_MS = 4 * 60 * 60_000;

export interface AwayEvents {
	finished: { botId: string; title: string; entryId?: string }[];
	waiting: { botId: string; title: string; entryId?: string }[];
	failed: { botId: string; title: string; entryId?: string }[];
}

export interface CatchUpSummary {
	since: number;
	summary: string;
	finished: AwayEvents["finished"];
	waiting: AwayEvents["waiting"];
	failed: AwayEvents["failed"];
}

export async function catchUp(input: {
	lastActivityAt: number;
	now?: number;
	events: AwayEvents;
	helper: Helper;
}): Promise<CatchUpSummary | undefined> {
	const now = input.now ?? Date.now();
	if (now - input.lastActivityAt < AWAY_MS) return undefined;
	const { finished, waiting, failed } = input.events;
	if (finished.length + waiting.length + failed.length === 0) return undefined;
	const list = (label: string, items: { title: string }[]) => (items.length ? `${label}:\n${items.map((item) => `- ${item.title}`).join("\n")}` : "");
	const summary = await input.helper(
		"Write a short 'While you were away' note for the owner of these bots: two or three plain sentences, what matters most first. Do not invent anything.",
		[list("Finished", finished), list("Waiting on the owner", waiting), list("Failed", failed)].filter(Boolean).join("\n\n"),
	);
	return { since: input.lastActivityAt, summary: summary.trim(), finished, waiting, failed };
}
