import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { DESKTOP_KEYBINDINGS, matchesBinding } from "../../src/shared/keybindings.ts";

const key = (k: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>> = {}) => ({
	key: k,
	ctrlKey: false,
	metaKey: false,
	shiftKey: false,
	altKey: false,
	...mods,
});

test("mod is Ctrl on Windows and Linux, Cmd on macOS", () => {
	expect(matchesBinding(key("n", { ctrlKey: true }), "desktop.thread.new", false)).toBe(true);
	expect(matchesBinding(key("n", { metaKey: true }), "desktop.thread.new", false)).toBe(false);
	expect(matchesBinding(key("n", { metaKey: true }), "desktop.thread.new", true)).toBe(true);
	expect(matchesBinding(key("n", { ctrlKey: true }), "desktop.thread.new", true)).toBe(false);
});

test("modifiers must match exactly: Enter sends, Shift+Enter does not", () => {
	expect(matchesBinding(key("Enter"), "desktop.composer.send", false)).toBe(true);
	expect(matchesBinding(key("Enter", { shiftKey: true }), "desktop.composer.send", false)).toBe(false);
	expect(matchesBinding(key("Enter", { ctrlKey: true }), "desktop.composer.steer", false)).toBe(true);
});

test("off macOS ctrl names mod, and the Windows key blocks a match", () => {
	const ctrlJ = { "desktop.palette": ["ctrl+j"] };
	expect(matchesBinding(key("j", { ctrlKey: true }), "desktop.palette", false, ctrlJ)).toBe(true);
	expect(matchesBinding(key("j", { ctrlKey: true }), "desktop.palette", true, ctrlJ)).toBe(true);
	expect(matchesBinding(key("j", { metaKey: true }), "desktop.palette", true, ctrlJ)).toBe(false);
	expect(matchesBinding(key("Enter", { metaKey: true }), "desktop.composer.send", false)).toBe(false);
});

test("overrides replace the defaults for one id", () => {
	expect(matchesBinding(key("j", { ctrlKey: true }), "desktop.palette", false, { "desktop.palette": ["mod+j"] })).toBe(
		true,
	);
	expect(matchesBinding(key("k", { ctrlKey: true }), "desktop.palette", false, { "desktop.palette": ["mod+j"] })).toBe(
		false,
	);
});

test("every binding has a description and at least one key", () => {
	for (const [id, binding] of Object.entries(DESKTOP_KEYBINDINGS)) {
		expect(binding.description, id).not.toBe("");
		expect(binding.defaultKeys.length, id).toBeGreaterThan(0);
	}
});

test("no renderer source compares keys directly; handlers go through the binding ids", () => {
	const root = join(import.meta.dirname, "../../src/renderer");
	const files: string[] = [];
	const walk = (dir: string) => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (/\.tsx?$/.test(name)) files.push(path);
		}
	};
	walk(root);
	const offenders = files.filter((f) => /\b(?:e|event|ev)\.(?:key|code)\s*[!=]==/.test(readFileSync(f, "utf8")));
	expect(offenders).toEqual([]);
});
