import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { comboFromEvent, DESKTOP_KEYBINDINGS, matchesBinding } from "../../src/shared/keybindings.ts";

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

test("punctuation keys match the physical key, whatever Shift or the layout makes of it", () => {
	// Ctrl+Shift+= types "+", and Ctrl+[ is "ü" on a German layout; both still mean their key.
	expect(
		matchesBinding({ ...key("+", { ctrlKey: true, shiftKey: true }), code: "Equal" }, "desktop.view.zoomIn", false),
	).toBe(true);
	expect(matchesBinding({ ...key("ü", { ctrlKey: true }), code: "BracketLeft" }, "desktop.nav.back", false)).toBe(true);
	expect(matchesBinding({ ...key("[", { ctrlKey: true }), code: "BracketRight" }, "desktop.nav.back", false)).toBe(
		false,
	);
	expect(matchesBinding(key("ArrowLeft", { altKey: true }), "desktop.nav.back", false)).toBe(true);
});

test("a recorded key press is the binding that matches it again", () => {
	const presses = [
		{ ...key("k", { ctrlKey: true, shiftKey: true }), code: "KeyK" },
		{ ...key("+", { ctrlKey: true, shiftKey: true }), code: "Equal" },
		{ ...key("1", { altKey: true }), code: "Digit1" },
		{ ...key(" ", { ctrlKey: true }), code: "Space" },
		{ ...key("F5"), code: "F5" },
	];
	expect(presses.map((p) => comboFromEvent(p, false))).toEqual([
		"mod+shift+k",
		"mod+shift+equal",
		"alt+digit1",
		"mod+space",
		"f5",
	]);
	for (const press of presses)
		expect(
			matchesBinding(press, "desktop.palette", false, { "desktop.palette": [comboFromEvent(press, false)!] }),
		).toBe(true);
	// Cmd is mod on macOS, and Ctrl stays itself there.
	expect(comboFromEvent({ ...key("k", { metaKey: true, ctrlKey: true }), code: "KeyK" }, true)).toBe("mod+ctrl+k");
	// A lone modifier is not a shortcut yet.
	expect(comboFromEvent({ ...key("Shift", { shiftKey: true }), code: "ShiftLeft" }, false)).toBeUndefined();
});

test("an empty override unassigns a binding", () => {
	expect(matchesBinding(key("k", { ctrlKey: true }), "desktop.palette", false, { "desktop.palette": [] })).toBe(false);
});

test("overrides replace the defaults for one id", () => {
	expect(matchesBinding(key("j", { ctrlKey: true }), "desktop.palette", false, { "desktop.palette": ["mod+j"] })).toBe(
		true,
	);
	expect(matchesBinding(key("k", { ctrlKey: true }), "desktop.palette", false, { "desktop.palette": ["mod+j"] })).toBe(
		false,
	);
});

test("every binding has a description, and a key unless Codex leaves the action unassigned too", () => {
	const unassigned = ["desktop.thread.fork", "desktop.thread.openWindow", "desktop.thread.delete"];
	for (const [id, binding] of Object.entries(DESKTOP_KEYBINDINGS)) {
		expect(binding.description, id).not.toBe("");
		expect(binding.defaultKeys.length === 0, id).toBe(unassigned.includes(id));
	}
});

test("Codex's thread navigation keys: Alt+digit is the sidebar slot, Ctrl+Alt+digit the recent one", () => {
	type Mods = Parameters<typeof key>[1];
	const physical = (k: string, code: string, mods: Mods) => ({ ...key(k, mods), code });
	const ctrlAlt = { ctrlKey: true, altKey: true };
	expect(matchesBinding(physical("2", "Digit2", { altKey: true }), "desktop.thread.goTo2", false)).toBe(true);
	expect(matchesBinding(physical("2", "Digit2", ctrlAlt), "desktop.thread.goTo2", false)).toBe(false);
	expect(matchesBinding(physical("2", "Digit2", ctrlAlt), "desktop.thread.recent2", false)).toBe(true);
	const semicolon = physical(";", "Semicolon", { ctrlKey: true, shiftKey: true });
	expect(matchesBinding(semicolon, "desktop.thread.copyCode", false)).toBe(true);
	// Ctrl+[ goes back; with Alt it is the previous sidebar item.
	expect(matchesBinding(physical("[", "BracketLeft", ctrlAlt), "desktop.nav.back", false)).toBe(false);
	expect(matchesBinding(physical("[", "BracketLeft", ctrlAlt), "desktop.thread.previous", false)).toBe(true);
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
