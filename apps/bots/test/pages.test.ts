// apps/bots/test/pages.test.ts
import type { PageBlock } from "@knightcode/bots-protocol";
import { env, runInDurableObject } from "cloudflare:test";
import { afterEach, expect, it } from "vitest";
import { setModelsFactory } from "../src/bot/models.ts";
import { PageRefused, PageStore, validateBlocks } from "../src/pages/pages.ts";
import { refreshPage, refreshWidget } from "../src/pages/widgets.ts";

afterEach(() => setModelsFactory(undefined));

const withPages = <T>(name: string, fn: (pages: PageStore) => T | Promise<T>) =>
	runInDurableObject(env.USER.get(env.USER.idFromName(name)), (_instance, state) => fn(new PageStore(state.storage.sql)));

it("rejects a block carrying HTML or script", () => {
	expect(() => validateBlocks([{ type: "text", id: "t1", text: "Hi <script>alert(1)</script>" }])).toThrow(PageRefused);
	expect(() => validateBlocks([{ type: "text", id: "t1", text: '<img src=x onerror="alert(1)">' }])).toThrow(/HTML or script/);
	expect(() => validateBlocks([{ type: "html", id: "h1", html: "<b>x</b>" }])).toThrow(PageRefused);
	expect(() => validateBlocks([{ type: "table", id: "t2", columns: ["a"], rows: [["javascript:alert(1)"]] }])).toThrow(PageRefused);
	// Markdown and structured blocks are fine.
	expect(validateBlocks([{ type: "text", id: "t1", text: "# Report\n\n**Revenue** is up 3% (a < b)." }])).toHaveLength(1);
});

it("keeps versions and lets a bot edit only its own pages", async () => {
	await withPages("pages-owner", (pages) => {
		const page = pages.create("b1", "Weekly report", [{ type: "text", id: "t1", text: "Draft" }], "b1");
		expect(page.version).toBe(1);
		const edited = pages.update(page.id, { kind: "bot", botId: "b1" }, { blocks: [{ type: "text", id: "t1", text: "Final" }] });
		expect(edited.version).toBe(2);
		expect(() => pages.update(page.id, { kind: "bot", botId: "b2" }, { title: "Mine now" })).toThrow(/only pages it created/);
		// The user edits any page; a stale base version is refused.
		expect(pages.update(page.id, { kind: "user" }, { title: "Weekly report (user)", baseVersion: 2 }).version).toBe(3);
		expect(() => pages.update(page.id, { kind: "user" }, { title: "x", baseVersion: 2 })).toThrow(/changed since/);
		expect(pages.versions(page.id).map((v) => [v.version, v.author])).toEqual([
			[3, "user"],
			[2, "b1"],
			[1, "b1"],
		]);
		expect(pages.markdown(page.id)).toContain("# Weekly report (user)");
	});
});

it("refreshes widgets by reading data, with no model call", async () => {
	let modelCalls = 0;
	setModelsFactory(() => {
		modelCalls++;
		throw new Error("a widget refresh must not reach a model");
	});
	const widget: Extract<PageBlock, { type: "widget" }> = {
		type: "widget",
		id: "w1",
		title: "Open invoices",
		source: { kind: "routine", ref: "b1/rt_invoices" },
		view: "number",
	};
	const readers = {
		routineOutput: async () => "There are 7 open invoices.",
		connectorRead: async () => ({ rows: [] }),
		file: async () => undefined,
	};
	const refreshed = await refreshWidget(widget, readers, 1_000);
	expect(refreshed).toMatchObject({ data: 7, refreshedAt: 1_000 });
	const blocks = await refreshPage([{ type: "text", id: "t", text: "x" }, { ...widget, view: "list", source: { kind: "file", ref: "f1" } }], {
		...readers,
		file: async () => "- one\n- two",
	});
	expect(blocks[1]).toMatchObject({ data: ["one", "two"] });
	// A source that cannot be read leaves the widget as it was.
	expect(await refreshWidget(widget, { ...readers, routineOutput: async () => Promise.reject(new Error("down")) })).toBe(widget);
	expect(modelCalls).toBe(0);
});
