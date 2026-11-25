import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { StateFile } from "../../src/main/state.ts";
import { ExtensionProviderPreferences } from "../../src/main/extension-preferences.ts";
const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
test("app choices persist, window overrides stay separate, and ordinary state writes cannot erase them", () => {
	const root = mkdtempSync(join(tmpdir(), "kc-extension-preference-"));
	roots.push(root);
	const state = new StateFile(root);
	const stale = state.read();
	const preferences = new ExtensionProviderPreferences(state);
	preferences.set("feedback", "external/one", "app", 1);
	preferences.set("feedback", "external/two", "window", 2);
	expect(preferences.read(1)).toEqual({ app: { feedback: "external/one" }, window: {} });
	expect(preferences.read(2)).toEqual({ app: { feedback: "external/one" }, window: { feedback: "external/two" } });
	state.write({ ...stale, pinnedThreads: ["retained"] });
	expect(new ExtensionProviderPreferences(new StateFile(root)).read(2)).toEqual({
		app: { feedback: "external/one" },
		window: {},
	});
	expect(state.read().pinnedThreads).toEqual(["retained"]);
	preferences.releaseWindow(2);
	expect(preferences.read(2).window).toEqual({});
});
