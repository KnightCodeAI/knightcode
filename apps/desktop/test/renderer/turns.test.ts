import type { Item, Turn } from "@knightcode/app-server-protocol";
import { expect, test } from "vitest";
import { placeItem, toView, type ViewItem } from "../../src/renderer/turns.ts";

const user: Item = { type: "userMessage", id: "t:user:0", text: "go", images: [] };
const call = (id: string, parent?: string): Item => ({
	type: "toolCall",
	id,
	tool: "bash",
	input: {},
	status: "completed",
	output: [],
	...(parent ? { parentItemId: parent } : {}),
});
const text = (id: string, body: string): Item => ({ type: "agentMessage", id, text: body });
const at = (item: Item, index?: number): ViewItem => (index === undefined ? item : { ...item, index });

test("a streamed item that a tool call overtakes at message end ends where read-back puts it", () => {
	// Text streams first at a provisional index; the finalized message is [toolCall, text].
	let items: ViewItem[] = [];
	items = placeItem(items, at(user, 0));
	items = placeItem(items, at(text("t:0:1", "partial"), 1));
	items = placeItem(items, at(call("c1"), 1));
	items = placeItem(items, at(text("t:0:1", "final"), 2));
	const readBack: Turn = {
		id: "t",
		threadId: "th",
		status: "completed",
		startedAt: 0,
		items: [user, call("c1"), text("t:0:1", "final")],
	};
	expect(items).toEqual(toView(readBack).items);
});

test("nested calls carry no index and stay after the top-level items", () => {
	let items: ViewItem[] = [];
	items = placeItem(items, at(user, 0));
	items = placeItem(items, at(call("parent"), 1));
	items = placeItem(items, at(call("child", "parent")));
	items = placeItem(items, at(text("t:1:0", "done"), 2));
	expect(items.map((i) => i.id)).toEqual(["t:user:0", "parent", "t:1:0", "child"]);
	expect(
		toView({
			id: "t",
			threadId: "th",
			status: "completed",
			startedAt: 0,
			items: [user, call("parent"), call("child", "parent")],
		}).items.map((i) => i.index),
	).toEqual([0, 1, undefined]);
});

test("replacing an item keeps one copy with the latest content", () => {
	let items = placeItem([], at(text("a", "one"), 0));
	items = placeItem(items, at(text("a", "two"), 0));
	expect(items).toEqual([at(text("a", "two"), 0)]);
});
