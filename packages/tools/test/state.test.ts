import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
	applyActiveTools,
	describeMode,
	readPersisted,
	resetSessionOverrides,
	resolveEnabled,
	setMode,
	writePersisted,
} from "../src/state.ts";

const entries = [
	{ tool: { name: "alpha" }, defaultEnabled: true },
	{ tool: { name: "beta" }, defaultEnabled: false },
];

function fakePi(active: string[]) {
	const calls: string[][] = [];
	return {
		calls,
		active,
		getActiveTools: () => [...active],
		setActiveTools: (names: string[]) => {
			calls.push([...names]);
			active.splice(0, active.length, ...names);
		},
	};
}

describe("resolveEnabled", () => {
	test("falls back to the tool default when nothing is set", () => {
		expect(resolveEnabled("alpha", true, {}, new Map())).toBe(true);
		expect(resolveEnabled("alpha", false, {}, new Map())).toBe(false);
	});

	test("persisted value beats the default", () => {
		expect(resolveEnabled("alpha", true, { alpha: false }, new Map())).toBe(false);
	});

	test("session override beats persisted", () => {
		expect(resolveEnabled("alpha", true, { alpha: false }, new Map([["alpha", true]]))).toBe(true);
	});
});

describe("persisted file", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "kc-tools-state-"));
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test("missing file reads as empty", () => {
		expect(readPersisted(join(dir, "tools.json"))).toEqual({});
	});

	test("unparsable file reads as empty", () => {
		const file = join(dir, "tools.json");
		writeFileSync(file, "{not json", "utf8");
		expect(readPersisted(file)).toEqual({});
	});

	test("non-boolean values are dropped", () => {
		const file = join(dir, "tools.json");
		writeFileSync(file, JSON.stringify({ alpha: false, beta: "yes", gamma: 1 }), "utf8");
		expect(readPersisted(file)).toEqual({ alpha: false });
	});

	test("round-trips through a nested directory and leaves no temp file", () => {
		const file = join(dir, "nested", "tools.json");
		writePersisted({ alpha: false }, file);
		expect(readPersisted(file)).toEqual({ alpha: false });
		expect(readFileSync(file, "utf8").endsWith("\n")).toBe(true);
		expect(readdirSync(dirname(file))).toEqual(["tools.json"]);
	});
});

describe("setMode", () => {
	let file: string;
	beforeEach(() => {
		file = join(mkdtempSync(join(tmpdir(), "kc-tools-mode-")), "tools.json");
		resetSessionOverrides();
	});
	afterEach(() => {
		rmSync(join(file, ".."), { recursive: true, force: true });
		resetSessionOverrides();
	});

	test("off persists false and clears a session override", async () => {
		await setMode("alpha", "session", file);
		await setMode("alpha", "off", file);
		expect(readPersisted(file)).toEqual({ alpha: false });
		expect(resolveEnabled("alpha", true, readPersisted(file))).toBe(false);
	});

	test("session enables now without touching the file", async () => {
		await setMode("alpha", "session", file);
		expect(readPersisted(file)).toEqual({});
		expect(resolveEnabled("alpha", false, {})).toBe(true);
	});

	test("always persists true and clears a session override", async () => {
		await setMode("beta", "session", file);
		await setMode("beta", "always", file);
		expect(readPersisted(file)).toEqual({ beta: true });
		expect(describeMode(entries[1], readPersisted(file))).toBe("on (default)");
	});

	test("concurrent writers serialize: both changes land and no lock or temp file remains", async () => {
		await Promise.all([setMode("alpha", "off", file), setMode("beta", "always", file)]);
		expect(readPersisted(file)).toEqual({ alpha: false, beta: true });
		expect(readdirSync(dirname(file))).toEqual(["tools.json"]);
	});

	test("describeMode reports each state", async () => {
		expect(describeMode(entries[0], {})).toBe("on (default)");
		expect(describeMode(entries[1], {})).toBe("off");
		await setMode("beta", "session", file);
		expect(describeMode(entries[1], {})).toBe("on (this session)");
	});
});

describe("applyActiveTools", () => {
	beforeEach(() => resetSessionOverrides());

	test("adds enabled and removes disabled registry tools, leaving others alone", () => {
		const pi = fakePi(["read", "beta"]);
		expect(applyActiveTools(pi, entries, {})).toBe(true);
		expect(pi.active).toEqual(["read", "alpha"]);
	});

	test("does not call setActiveTools when nothing changes", () => {
		const pi = fakePi(["read", "alpha"]);
		expect(applyActiveTools(pi, entries, {})).toBe(false);
		expect(pi.calls).toEqual([]);
	});

	test("honours persisted false over the default", () => {
		const pi = fakePi(["alpha"]);
		applyActiveTools(pi, entries, { alpha: false });
		expect(pi.active).toEqual([]);
	});
});
