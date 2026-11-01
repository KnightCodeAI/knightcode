import type { Bot, InboxItem } from "@knightcode/bots-protocol";
import { describe, expect, it } from "vitest";
import { awayFor, isAway } from "../src/inbox/CatchUp.tsx";
import { groupInbox } from "../src/inbox/Inbox.tsx";

const item = (id: string, botId: string, createdAt: number, extra: Partial<InboxItem> = {}): InboxItem => ({
	id,
	kind: "question",
	botId,
	title: id,
	createdAt,
	pinned: false,
	done: false,
	read: false,
	...extra,
});
const bot = (id: string) => ({ id, name: id }) as Bot;

describe("groupInbox", () => {
	const items = [
		item("a", "inbox", 3),
		item("b", "reviewer", 1),
		item("c", "inbox", 5, { pinned: true }),
		item("d", "reviewer", 2, { done: true }),
		item("e", "reviewer", 4, { read: true }),
	];
	it("puts pinned first, then bots in sidebar order, newest first, hiding done", () => {
		const groups = groupInbox(items, [bot("reviewer"), bot("inbox")], "open");
		expect(groups.map((g) => [g.key, g.items.map((i) => i.id)])).toEqual([
			["pinned", ["c"]],
			["reviewer", ["e", "b"]],
			["inbox", ["a"]],
		]);
	});
	it("filters unread and done", () => {
		expect(
			groupInbox(items, [bot("reviewer"), bot("inbox")], "unread").flatMap((g) => g.items.map((i) => i.id)),
		).toEqual(["c", "b", "a"]);
		expect(groupInbox(items, [bot("reviewer"), bot("inbox")], "done").flatMap((g) => g.items.map((i) => i.id))).toEqual(
			["d"],
		);
	});
});

describe("awayFor", () => {
	it("reads ?away durations, else the gap since the last activity", () => {
		expect(awayFor("5h", 0, undefined)).toBe(5 * 3_600_000);
		expect(awayFor("30m", 0, undefined)).toBe(30 * 60_000);
		expect(awayFor(null, 10 * 3_600_000, 3_600_000)).toBe(9 * 3_600_000);
		expect(awayFor(null, 10, undefined)).toBe(0);
		expect(isAway(awayFor("4h"))).toBe(true);
		expect(isAway(awayFor("3h"))).toBe(false);
	});
});
