import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
	updateSettings,
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
		expect(resolveEnabled("alpha", true, { alpha: { enabled: false } }, new Map())).toBe(false);
	});

	test("settings without an enabled flag leave the default alone", () => {
		expect(resolveEnabled("alpha", true, { alpha: { provider: "brave" } }, new Map())).toBe(true);
	});

	test("session override beats persisted", () => {
		expect(resolveEnabled("alpha", true, { alpha: { enabled: false } }, new Map([["alpha", true]]))).toBe(true);
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

	test("a bare boolean is an enabled flag; other settings keep strings and booleans and drop the rest", () => {
		const file = join(dir, "tools.json");
		writeFileSync(
			file,
			JSON.stringify({
				alpha: false,
				beta: { enabled: "yes", provider: "brave", count: 1, nested: {} },
				gamma: "yes",
				delta: 1,
			}),
			"utf8",
		);
		expect(readPersisted(file)).toEqual({ alpha: { enabled: false }, beta: { provider: "brave" } });
	});

	test("round-trips through a nested directory, owner-only, and leaves no temp file", () => {
		const file = join(dir, "nested", "tools.json");
		writePersisted({ alpha: { enabled: false, provider: "brave" } }, file);
		expect(readPersisted(file)).toEqual({ alpha: { enabled: false, provider: "brave" } });
		expect(readFileSync(file, "utf8").endsWith("\n")).toBe(true);
		expect(readdirSync(dirname(file))).toEqual(["tools.json"]);
		// The file can hold an API key; Windows has no POSIX mode bits to check.
		if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
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
		expect(readPersisted(file)).toEqual({ alpha: { enabled: false } });
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
		expect(readPersisted(file)).toEqual({ beta: { enabled: true } });
		expect(describeMode(entries[1], readPersisted(file))).toBe("on (default)");
	});

	test("concurrent writers serialize: both changes land and no lock or temp file remains", async () => {
		await Promise.all([
			setMode("alpha", "off", file),
			setMode("beta", "always", file),
			updateSettings("beta", { provider: "brave" }, file),
		]);
		expect(readPersisted(file)).toEqual({ alpha: { enabled: false }, beta: { enabled: true, provider: "brave" } });
		expect(readdirSync(dirname(file))).toEqual(["tools.json"]);
	});

	test("setMode keeps a tool's other settings", async () => {
		await updateSettings("beta", { provider: "brave", braveApiKey: "k" }, file);
		await setMode("beta", "off", file);
		expect(readPersisted(file)).toEqual({ beta: { enabled: false, provider: "brave", braveApiKey: "k" } });
	});

	test("describeMode reports each state", async () => {
		expect(describeMode(entries[0], {})).toBe("on (default)");
		expect(describeMode(entries[1], {})).toBe("off");
		await setMode("beta", "session", file);
		expect(describeMode(entries[1], {})).toBe("on (this session)");
	});
});

describe("updateSettings", () => {
	let file: string;
	beforeEach(() => {
		file = join(mkdtempSync(join(tmpdir(), "kc-tools-settings-")), "tools.json");
	});
	afterEach(() => {
		rmSync(join(file, ".."), { recursive: true, force: true });
	});

	test("merges keys, and undefined deletes one", async () => {
		await updateSettings("beta", { provider: "brave", braveApiKey: "k" }, file);
		await updateSettings("beta", { braveApiKey: undefined }, file);
		expect(readPersisted(file)).toEqual({ beta: { provider: "brave" } });
	});

	test("removes the tool entry once nothing is left", async () => {
		await updateSettings("beta", { provider: "brave" }, file);
		await updateSettings("beta", { provider: undefined }, file);
		expect(readPersisted(file)).toEqual({});
	});

	test("writes from one process land in call order, and a failure does not block the next", async () => {
		const first = updateSettings("beta", { provider: "duckduckgo" }, file);
		const second = updateSettings("beta", { provider: "brave" }, file);
		// A write that cannot start: the target's parent is a file.
		writeFileSync(join(dirname(file), "blocker"), "");
		const failed = updateSettings("beta", { provider: "x" }, join(dirname(file), "blocker", "tools.json"));
		const third = updateSettings("beta", { provider: "duckduckgo" }, file);
		await Promise.all([first, second, third]);
		await expect(failed).rejects.toThrow();
		expect(readPersisted(file)).toEqual({ beta: { provider: "duckduckgo" } });
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
		applyActiveTools(pi, entries, { alpha: { enabled: false } });
		expect(pi.active).toEqual([]);
	});

	test("skips feature entries, which have no engine tool", () => {
		const pi = fakePi(["read"]);
		const withFeature = [...entries, { tool: { name: "gamma", feature: true as const }, defaultEnabled: true }];
		expect(applyActiveTools(pi, withFeature, {})).toBe(true);
		expect(pi.active).toEqual(["read", "alpha"]);
	});
});
