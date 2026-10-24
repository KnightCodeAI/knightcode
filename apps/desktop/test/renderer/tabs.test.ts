import { expect, test, vi } from "vitest";

vi.hoisted(() => {
	Object.assign(globalThis, { window: { addEventListener: () => {}, knightcode: { platform: "win32" } } });
});

vi.mock("../../src/renderer/client.ts", () => ({
	client: { onNotification: () => {}, onServerRequest: () => {}, onHostEvent: () => {} },
	RequestError: class extends Error {},
}));

import {
	activateTab,
	closeTab,
	getState,
	keepTab,
	MAX_FILE_TABS,
	NO_TABS,
	openFileTab,
	setFileComparison,
	setPanel,
	showChanges,
} from "../../src/renderer/store.ts";

const tabsOf = (id: string) => getState().tabs[id] ?? NO_TABS;
const paths = (id: string) => tabsOf(id).tabs.map((t) => (t.kind === "file" ? t.path : "changes"));

test("a file opens as the preview tab, which the next file replaces until it is kept", () => {
	openFileTab("a", "C:\\p\\one.ts", 3);
	expect(getState().panel.open).toBe(true);
	expect(tabsOf("a")).toMatchObject({ active: 1, tabs: [{ kind: "changes" }, { path: "C:\\p\\one.ts", line: 3, preview: true }] });
	openFileTab("a", "C:\\p\\two.ts");
	expect(paths("a")).toEqual(["changes", "C:\\p\\two.ts"]);
	keepTab("a", 1);
	openFileTab("a", "C:\\p\\three.ts");
	expect(paths("a")).toEqual(["changes", "C:\\p\\two.ts", "C:\\p\\three.ts"]);
	// The same file, however it is spelled, is its tab again, at the new line.
	openFileTab("a", "c:/p/TWO.ts", 9);
	expect(tabsOf("a")).toMatchObject({ active: 1, tabs: [{}, { path: "C:\\p\\two.ts", line: 9 }, {}] });
	// Another thread has its own tabs.
	expect(paths("b")).toEqual(["changes"]);
});

test("a 13th file tab closes the least recently used one", () => {
	for (let i = 0; i < MAX_FILE_TABS; i++) {
		openFileTab("c", `/p/${i}.ts`);
		keepTab("c", i + 1);
	}
	activateTab("c", 1); // /p/0.ts is now the most recently used
	openFileTab("c", "/p/new.ts");
	const files = paths("c").slice(1);
	expect(files).toHaveLength(MAX_FILE_TABS);
	expect(files).toContain("/p/0.ts");
	expect(files).not.toContain("/p/1.ts");
	expect(tabsOf("c").tabs[tabsOf("c").active]).toMatchObject({ path: "/p/new.ts" });
});

test("Changes cannot close: closing it closes the panel; a closed tab hands over to its left", () => {
	openFileTab("d", "/p/a.ts");
	keepTab("d", 1);
	openFileTab("d", "/p/b.ts");
	closeTab("d", 0);
	expect(getState().panel.open).toBe(false);
	expect(paths("d")).toEqual(["changes", "/p/a.ts", "/p/b.ts"]);
	closeTab("d", 2);
	expect(tabsOf("d")).toMatchObject({ active: 1 });
	activateTab("d", 1);
	closeTab("d", 1);
	expect(tabsOf("d")).toEqual({ tabs: [{ kind: "changes" }], active: 0 });
	setPanel({ open: false });
	showChanges("d", "lastTurn");
	expect(getState().panel).toMatchObject({ open: true, scope: "lastTurn" });
});

test("a file opened from a list of changes shows them; reopened without a comparison it keeps its own", () => {
	openFileTab("e", "/p/a.ts", undefined, false, { scope: "unstaged" });
	expect(tabsOf("e").tabs[1]).toMatchObject({ path: "/p/a.ts", compare: { scope: "unstaged" } });
	openFileTab("e", "/p/a.ts", 4);
	expect(tabsOf("e").tabs[1]).toMatchObject({ line: 4, compare: { scope: "unstaged" } });
	setFileComparison("e", "/p/a.ts", { scope: "branch", against: "main" });
	expect(tabsOf("e").tabs[1]).toMatchObject({ compare: { scope: "branch", against: "main" } });
	setFileComparison("e", "/p/a.ts", undefined);
	expect(tabsOf("e").tabs[1]).not.toHaveProperty("compare.scope");
});
