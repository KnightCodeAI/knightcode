import { setKeybindings, type TUI } from "@knightcode/tui";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../../src/core/keybindings.ts";
import type { McpServerState } from "../../src/extensions/mcp/control.ts";
import type { McpUi } from "../../src/extensions/mcp/ui.ts";
import {
	type BrowseAction,
	type BrowseOptions,
	type BrowseTab,
	managePlugins,
	type PluginMenu,
	type PluginsMcp,
	PluginsView,
	type PluginsUi,
} from "../../src/extensions/plugins/ui.ts";
import { initTheme, theme } from "../../src/modes/interactive/theme/theme.ts";
import { PluginManager } from "../../src/plugins/manager.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";
import { useTempDirs, writeTree } from "./helpers.ts";

const tempDir = useTempDirs();
const tui = { requestRender: vi.fn() } as unknown as TUI;
const ENTER = "\r";
const ESCAPE = "\x1b";
const DOWN = "\x1b[B";
const TAB = "\t";

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

	it("filters a menu by typed text and confirms the selection", async () => {
		const view = new PluginsView(tui, theme, new KeybindingsManager());
		const choice = view.menu(menu);
		for (const char of "mm") view.handleInput(char);
		const text = stripAnsi(view.render(80).join("\n"));
		expect(text).toContain("gamma");
		expect(text).not.toContain("alpha");
		view.handleInput(ENTER);
		expect(await choice).toBe("c");
	});

	const tabs = (): BrowseTab[] => [
		{
			id: "plugins",
			label: "Plugins",
			groups: [
				{
					key: "user",
					label: "User",
					rows: [
						{
							key: "plugin:demo",
							label: "demo",
							badge: { text: "needs sign-in", tone: "warning" },
							actions: { space: "disable", x: "uninstall" },
						},
					],
				},
			],
			actions: { a: "install from source" },
			empty: "No plugins.",
		},
		{
			id: "marketplace",
			label: "Marketplace",
			groups: [
				{
					key: "market:shop",
					label: "shop",
					actions: { x: "remove" },
					rows: [
						{ key: "entry:alpha", label: "alpha", description: "First", actions: { enter: "install" } },
						{ key: "entry:beta", label: "beta", description: "Second", actions: { enter: "install" } },
					],
				},
			],
			actions: {},
			empty: "No marketplaces.",
		},
	];
	const screen = (view: PluginsView) => stripAnsi(view.render(100).join("\n"));

	it("shows tabs with row badges and returns the key a row offers", async () => {
		const view = new PluginsView(tui, theme, new KeybindingsManager());
		const action = view.browse(tabs);
		const text = screen(view);
		expect(text).toMatch(/Plugins\s+Marketplace/);
		expect(text).toMatch(/demo\s+\[needs sign-in\]/);
		expect(text).toMatch(/space disable/);
		// A key the row does not offer does nothing.
		view.handleInput("u");
		view.handleInput(" ");
		expect(await action).toEqual({ tab: "plugins", key: "space", target: "plugin:demo" });
	});

	it("searches every tab at once and acts on a match in another tab", async () => {
		const view = new PluginsView(tui, theme, new KeybindingsManager());
		const action = view.browse(tabs);
		view.handleInput("/");
		for (const char of "alp") view.handleInput(char);
		expect(screen(view)).toMatch(/Plugins \(0\)\s+Marketplace \(1\)/);
		expect(screen(view)).toContain("Nothing matches here; Marketplace has matches (tab).");
		view.handleInput(TAB);
		const text = screen(view);
		expect(text).toContain("alpha");
		expect(text).not.toContain("beta");
		view.handleInput(DOWN);
		view.handleInput(ENTER);
		expect(await action).toEqual({ tab: "marketplace", key: "enter", target: "entry:alpha" });
	});

	it("collapses a group with enter and closes with escape", async () => {
		const view = new PluginsView(tui, theme, new KeybindingsManager());
		const action = view.browse(tabs, { focus: { tab: "marketplace", key: "market:shop" } });
		expect(screen(view)).toContain("beta");
		view.handleInput(ENTER);
		expect(screen(view)).not.toContain("beta");
		view.handleInput(ESCAPE);
		expect(await action).toBeUndefined();
	});
});

type Answer = string | BrowseAction | undefined;

/** A UI that answers from a script and records what it showed. */
function scriptedUi(answers: Answer[]) {
	const menus: PluginMenu[] = [];
	const screens: BrowseTab[][] = [];
	const options: BrowseOptions[] = [];
	const statuses: string[] = [];
	const mcpUi = {} as McpUi;
	const ui: PluginsUi = {
		async browse(build, browseOptions = {}) {
			screens.push(build());
			options.push(browseOptions);
			return answers.shift() as BrowseAction | undefined;
		},
		async menu(menu) {
			menus.push(menu);
			return answers.shift() as string | undefined;
		},
		async input() {
			return answers.shift() as string | undefined;
		},
		status(title) {
			statuses.push(title);
		},
		mcpUi: () => mcpUi,
	};
	return { ui, menus, screens, options, statuses, mcpUi };
}

const row = (screen: BrowseTab[] | undefined, key: string) =>
	screen?.flatMap((tab) => tab.groups.flatMap((group) => group.rows)).find((candidate) => candidate.key === key);

/** MCP servers in a fixed state once the plugin's servers are registered. */
function fakeMcp(state: McpServerState) {
	let registered = false;
	const mcp: PluginsMcp = {
		list: () => (registered ? [{ name: "plugin_demo_api", state, tools: state === "connected" ? 3 : 0 }] : []),
		subscribe: () => () => {},
		manage: vi.fn(async () => {}),
	};
	return { mcp, applyMcp: () => ((registered = true), []) };
}

describe("/plugins", () => {
	const demo = () =>
		writeTree(tempDir(), {
			"plugin.json": { name: "demo", mcpServers: { api: { command: "node", args: ["server.js"] } } },
			"commands/go.md": "go",
		});

	async function setup() {
		const agentDir = tempDir();
		const manager = new PluginManager({ agentDir, cwd: agentDir });
		await manager.install(demo(), {});
		return { manager, reload: vi.fn(async () => {}) };
	}

	const space: BrowseAction = { tab: "plugins", key: "space", target: "plugin:user:demo" };

	it("asks for trust with the plugin's inventory and leaves it untrusted on no", async () => {
		const { manager, reload } = await setup();
		const script = scriptedUi([space, "no", undefined]);
		await managePlugins(script.ui, manager, { reload });
		expect(row(script.screens[0], "plugin:user:demo")?.badge?.text).toBe("not trusted");
		expect(script.menus[0]?.details?.join("\n")).toMatch(/node server\.js/);
		expect(manager.details("demo").trusted).toBe(false);
		expect(reload).not.toHaveBeenCalled();
	});

	it("trusts and enables on yes, then offers a reload", async () => {
		const { manager, reload } = await setup();
		await managePlugins(scriptedUi([space, "yes", undefined, "reload"]).ui, manager, { reload });
		expect(manager.details("demo").trusted).toBe(true);
		expect(reload).toHaveBeenCalledOnce();
	});

	it("confirms before uninstalling and does nothing when cancelled", async () => {
		const { manager, reload } = await setup();
		const uninstall: BrowseAction = { tab: "plugins", key: "x", target: "plugin:user:demo" };
		await managePlugins(scriptedUi([uninstall, undefined, undefined]).ui, manager, { reload });
		expect(manager.list()).toHaveLength(1);
		await managePlugins(scriptedUi([uninstall, "yes", undefined]).ui, manager, { reload });
		expect(manager.list()).toHaveLength(0);
	});

	it("lays out Claude Code's installs and the marketplaces not added, and adds one", async () => {
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
		const script = scriptedUi([{ tab: "marketplace", key: "enter", target: "known:shop" }, undefined]);
		await managePlugins(script.ui, new PluginManager({ agentDir, cwd: agentDir }), { reload: vi.fn() });
		const [plugins, marketplace] = script.screens[0] ?? [];
		expect(plugins?.groups.map((group) => group.label)).toEqual(["In Claude Code"]);
		expect(row(script.screens[0], "import:alpha@shop")?.actions).toEqual({ enter: "import", i: "import" });
		expect(marketplace?.groups.flatMap((group) => group.rows.map((known) => `${known.key} ${known.right}`))).toEqual([
			"known:claude-plugins-official Anthropic",
			"known:xai-official xAI",
			"known:shop Claude Code",
		]);
		expect(script.options[1]?.focus).toEqual({ tab: "marketplace", key: "market:shop" });
		expect(script.screens[1]?.[1]?.groups[0]?.rows.map((entry) => entry.key)).toEqual([
			"entry:alpha@shop",
			"entry:beta@shop",
		]);
	});

	it("opens /mcp for a plugin server that asks for a sign-in after the install", async () => {
		const agentDir = tempDir();
		const manager = new PluginManager({ agentDir, cwd: agentDir });
		const { mcp, applyMcp } = fakeMcp("needs-auth");
		const script = scriptedUi([{ tab: "plugins", key: "a" }, demo(), "yes", undefined, "later"]);
		await managePlugins(script.ui, manager, { reload: vi.fn(), mcp, applyMcp });
		expect(mcp.manage).toHaveBeenCalledWith(["plugin_demo_api"], script.mcpUi);
		const installed = row(script.screens[1], "plugin:user:demo");
		expect(installed?.badge).toEqual({ text: "needs sign-in", tone: "warning" });
		expect(installed?.actions).toMatchObject({ enter: "sign in", m: "MCP servers" });
	});

	it("stays in /plugins when the plugin's servers connect, and shows them on the row", async () => {
		const agentDir = tempDir();
		const manager = new PluginManager({ agentDir, cwd: agentDir });
		const { mcp, applyMcp } = fakeMcp("connected");
		const script = scriptedUi([{ tab: "plugins", key: "a" }, demo(), "yes", undefined, "later"]);
		await managePlugins(script.ui, manager, { reload: vi.fn(), mcp, applyMcp });
		expect(mcp.manage).not.toHaveBeenCalled();
		expect(script.options[1]?.notice?.text).toMatch(/Installed demo/);
		expect(row(script.screens[1], "plugin:user:demo")?.description).toMatch(/MCP connected, 3 tools/);
	});
});
