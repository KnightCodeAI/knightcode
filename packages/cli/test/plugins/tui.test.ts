import { setKeybindings, type TUI } from "@knightcode/tui";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../../src/core/keybindings.ts";
import { managePlugins, type PluginMenu, PluginsView, type PluginsUi } from "../../src/extensions/plugins/ui.ts";
import { PluginManager } from "../../src/plugins/manager.ts";
import { initTheme, theme } from "../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";
import { useTempDirs, writeTree } from "./helpers.ts";

const tempDir = useTempDirs();
const tui = { requestRender: vi.fn() } as unknown as TUI;
const ENTER = "\r";
const ESCAPE = "\x1b";
const DOWN = "\x1b[B";

beforeAll(() => initTheme("dark"));
beforeEach(() => setKeybindings(new KeybindingsManager()));

describe("plugins view", () => {
	const menu: PluginMenu = {
		title: "Plugins",
		search: true,
		items: [
			{ value: "a", label: "alpha", description: "first" },
			{ value: "b", label: "beta", description: "second" },
			{ value: "c", label: "gamma", description: "third" },
		],
		confirmLabel: "open",
		cancelLabel: "close",
	};

	it("filters by typed text and confirms the selection", async () => {
		const view = new PluginsView(tui, theme, new KeybindingsManager());
		const choice = view.menu(menu);
		for (const char of "mm") view.handleInput(char);
		const text = stripAnsi(view.render(80).join("\n"));
		expect(text).toContain("gamma");
		expect(text).not.toContain("alpha");
		view.handleInput(ENTER);
		expect(await choice).toBe("c");
	});

	it("moves with the select keys and cancels with the cancel key", async () => {
		const view = new PluginsView(tui, theme, new KeybindingsManager());
		const moved = view.menu(menu);
		view.handleInput(DOWN);
		view.handleInput(ENTER);
		expect(await moved).toBe("b");
		const cancelled = view.menu(menu);
		view.handleInput(ESCAPE);
		expect(await cancelled).toBeUndefined();
	});
});

/** A UI that answers menus from a script and records what it showed. */
function scriptedUi(answers: Array<string | undefined>): PluginsUi & { shown: PluginMenu[] } {
	const shown: PluginMenu[] = [];
	return {
		shown,
		async menu(menu) {
			shown.push(menu);
			return answers.shift();
		},
		status() {},
	};
}

describe("/plugins", () => {
	async function setup() {
		const agentDir = tempDir();
		const source = writeTree(tempDir(), {
			"plugin.json": { name: "demo", mcpServers: { api: { command: "node", args: ["server.js"] } } },
			"commands/go.md": "go",
		});
		const manager = new PluginManager({ agentDir, cwd: agentDir });
		await manager.install(source, {});
		return { manager, notify: vi.fn(), reload: vi.fn(async () => {}) };
	}

	it("asks for trust with the plugin's inventory and leaves it untrusted on no", async () => {
		const { manager, notify, reload } = await setup();
		const ui = scriptedUi(["plugin:user:demo", "enable", "no", undefined, undefined]);
		await managePlugins(ui, manager, { notify, reload, projectTrusted: false });
		const trustMenu = ui.shown.find((menu) => menu.title.startsWith("Trust"));
		expect(trustMenu?.details?.join("\n")).toMatch(/node server\.js/);
		expect(manager.details("demo").trusted).toBe(false);
		expect(reload).not.toHaveBeenCalled();
	});

	it("trusts and enables on yes, then offers a reload", async () => {
		const { manager, notify, reload } = await setup();
		const ui = scriptedUi(["plugin:user:demo", "enable", "yes", undefined, "reload"]);
		await managePlugins(ui, manager, { notify, reload, projectTrusted: false });
		expect(manager.details("demo").trusted).toBe(true);
		expect(reload).toHaveBeenCalledOnce();
	});

	it("offers the built-in marketplaces and Claude Code's installs, and adds a marketplace when chosen", async () => {
		const claude = tempDir();
		vi.stubEnv("CLAUDE_CONFIG_DIR", claude);
		const market = writeTree(tempDir(), {
			".claude-plugin/marketplace.json": {
				name: "shop",
				plugins: [
					{ name: "alpha", source: "./plugins/alpha" },
					{ name: "beta", source: "./plugins/alpha" },
				],
			},
			"plugins/alpha/commands/a.md": "a",
		});
		writeTree(claude, {
			"plugins/known_marketplaces.json": { shop: { source: { source: "directory", path: market } } },
			"plugins/installed_plugins.json": {
				version: 2,
				plugins: { "alpha@shop": [{ scope: "user", installPath: "x" }] },
			},
		});
		const agentDir = tempDir();
		const manager = new PluginManager({ agentDir, cwd: agentDir });
		const ui = scriptedUi(["market:shop", undefined]);
		await managePlugins(ui, manager, { notify: vi.fn(), reload: vi.fn(async () => {}), projectTrusted: false });
		expect(ui.shown[0]?.items.map((item) => `${item.value} | ${item.description}`)).toEqual([
			"entry:alpha@shop | installed in Claude Code · import",
			"market:claude-plugins-official | Anthropic marketplace · not added · open to add it",
			"market:xai-official | xAI marketplace · not added · open to add it",
			"market:shop | Claude Code marketplace · not added · open to add it",
			"reload | apply plugin changes now",
		]);
		// Once added, its catalog shows; the plugin Claude Code has is offered once, as the import.
		expect(ui.shown[1]?.items.map((item) => item.value)).toEqual([
			"entry:alpha@shop",
			"market:claude-plugins-official",
			"market:xai-official",
			"entry:beta@shop",
			"reload",
		]);
	});

	it("confirms before uninstalling and does nothing when cancelled", async () => {
		const { manager, notify, reload } = await setup();
		await managePlugins(scriptedUi(["plugin:user:demo", "uninstall", undefined, undefined, undefined]), manager, {
			notify,
			reload,
			projectTrusted: false,
		});
		expect(manager.list()).toHaveLength(1);
		await managePlugins(scriptedUi(["plugin:user:demo", "uninstall", "yes", undefined]), manager, {
			notify,
			reload,
			projectTrusted: false,
		});
		expect(manager.list()).toHaveLength(0);
	});
});
