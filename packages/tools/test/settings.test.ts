import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENV_AGENT_DIR } from "@knightcodeai/cli/config";
import { initTheme, theme } from "@knightcodeai/cli/modes/interactive/theme/theme";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { TOOLS } from "../src/registry.ts";
import { maskKey, toolSettingsPanel } from "../src/settings.ts";
import { readPersisted, resetSessionOverrides, updateSettings } from "../src/state.ts";

const DOWN = "\x1b[B";
const ENTER = "\r";
const ESC = "\x1b";

const websearch = TOOLS.find((e) => e.tool.name === "websearch")!;
const webfetch = TOOLS.find((e) => e.tool.name === "webfetch")!;

function fakePi(active: string[]) {
	return {
		active,
		getActiveTools: () => [...active],
		setActiveTools: (names: string[]) => {
			active.splice(0, active.length, ...names);
		},
	};
}

function plain(lines: string[]): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI colour codes
	return lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
}

function openPanel(entry = websearch, active = ["read"]) {
	const pi = fakePi(active);
	let closed = 0;
	const panel = toolSettingsPanel(entry, TOOLS, pi, theme, () => closed++);
	const type = (...keys: string[]) => {
		for (const key of keys) panel.handleInput(key);
	};
	return { pi, panel, type, text: () => plain(panel.render(80)), closed: () => closed };
}

let dir: string;
beforeAll(() => initTheme("dark"));
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "kc-tools-panel-"));
	process.env[ENV_AGENT_DIR] = dir;
	resetSessionOverrides();
});
afterEach(() => {
	delete process.env[ENV_AGENT_DIR];
	rmSync(dir, { recursive: true, force: true });
	resetSessionOverrides();
});

describe("maskKey", () => {
	test("keeps only the last four characters", () => {
		expect(maskKey("BSA-abcdef-3f2a")).toBe("••••3f2a");
		expect(maskKey("ab")).toBe("••••");
	});
});

describe("toolSettingsPanel", () => {
	test("shows the status row alone for a tool without settings", () => {
		const { text } = openPanel(webfetch);
		expect(text()).toContain("webfetch");
		expect(text()).toContain("Status");
		expect(text()).toContain("Disabled");
		expect(text()).not.toContain("Provider");
	});

	test("websearch adds provider and key rows with their current values", async () => {
		await updateSettings("websearch", { provider: "brave", braveApiKey: "BSA-abcdef-3f2a" });
		const { text } = openPanel();
		expect(text()).toContain("Provider");
		expect(text()).toContain("brave");
		expect(text()).toContain("Brave API key");
		expect(text()).toContain("••••3f2a");
		expect(text()).not.toContain("BSA-abcdef");
	});

	test("Enter on Status cycles the mode and applies it to the active tools", async () => {
		const { pi, type, text } = openPanel();
		type(ENTER);
		expect(text()).toContain("Enabled for this session");
		await vi.waitFor(() => expect(pi.active).toEqual(["read", "websearch"]));
		type(ENTER);
		expect(text()).toContain("Enabled by default");
		await vi.waitFor(() => expect(readPersisted().websearch?.enabled).toBe(true));
		type(ENTER);
		await vi.waitFor(() => expect(readPersisted().websearch?.enabled).toBe(false));
		expect(pi.active).toEqual(["read"]);
	});

	test("picking Brave with no key stored persists the provider and opens the key prompt", async () => {
		const { type, text } = openPanel();
		type(DOWN, ENTER);
		expect(text()).toContain("DuckDuckGo");
		expect(text()).toContain("Brave Search");
		type(DOWN, ENTER);
		await vi.waitFor(() => expect(readPersisted().websearch?.provider).toBe("brave"));
		expect(text()).toContain("Paste");
		type(..."BSA-secret-9x8y", ENTER);
		await vi.waitFor(() => expect(readPersisted().websearch?.braveApiKey).toBe("BSA-secret-9x8y"));
		expect(text()).toContain("••••9x8y");
		expect(text()).not.toContain("BSA-secret");
	});

	test("picking Brave with a key stored does not open the prompt", async () => {
		await updateSettings("websearch", { braveApiKey: "k1234" });
		const { type, text } = openPanel();
		type(DOWN, ENTER, DOWN, ENTER);
		await vi.waitFor(() => expect(readPersisted().websearch?.provider).toBe("brave"));
		expect(text()).not.toContain("Paste");
		expect(text()).toContain("Provider");
	});

	test("submitting an empty key clears it; Esc keeps the old one", async () => {
		await updateSettings("websearch", { braveApiKey: "k1234" });
		const { type, text } = openPanel();
		type(DOWN, DOWN, ENTER);
		expect(text()).toContain("Paste");
		type(ESC);
		expect(readPersisted().websearch?.braveApiKey).toBe("k1234");
		expect(text()).toContain("••••1234");
		type(ENTER, ENTER);
		await vi.waitFor(() => expect(readPersisted().websearch?.braveApiKey).toBeUndefined());
		expect(text()).toContain("not set");
	});

	test("Esc on the main list closes the panel", () => {
		const { type, closed } = openPanel();
		type(ESC);
		expect(closed()).toBe(1);
	});
});
