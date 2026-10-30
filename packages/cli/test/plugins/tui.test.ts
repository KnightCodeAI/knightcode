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

	// PageDown has to reach the list in fullscreen instead of scrolling the transcript.
	it("captures fullscreen viewport keys while a list is shown, and leaves /mcp's screens to decide", () => {
		const view = new PluginsView(tui, theme, new KeybindingsManager());
		void view.browse(tabs);
		expect(view.capturesViewportInput).toBe(true);
		void view.menu(menu);
		expect(view.capturesViewportInput).toBe(true);
		view.status("Installing demo", "Fetching and checking the plugin…");
		expect(view.capturesViewportInput).toBe(false);
		const mcp = view.mcpUi();
		const items = [{ value: "plugin_demo_api", label: "plugin_demo_api" }];
		void mcp.menu(() => ({ title: "MCP servers", items, confirmLabel: "open", cancelLabel: "close" }));
		expect(view.capturesViewportInput).toBe(true);
		mcp.status("Sign in to demo", "Connecting…");
		expect(view.capturesViewportInput).toBe(false);
	});
});

/** A screen answer that waits until `ready` holds for the rebuilt tabs, as background fetches finish. */
type Waiting = (build: () => BrowseTab[], options: BrowseOptions) => Promise<BrowseAction | undefined>;
type Answer = string | BrowseAction | Waiting | undefined;

const when =
	(ready: (tabs: BrowseTab[]) => boolean, action?: BrowseAction): Waiting =>
	(build, options) =>
		new Promise((resolve) => {
			const check = () => {
				if (!ready(build())) return;
				off?.();
				resolve(action);
			};
			const off = options.subscribe?.(check);
			check();
		});

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
			const answer = answers.shift();
			return typeof answer === "function" ? answer(build, browseOptions) : (answer as BrowseAction | undefined);
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

	it("lists every known marketplace's plugins as Grok Build does, and installs one with enter", async () => {
		const claude = tempDir();
		vi.stubEnv("CLAUDE_CONFIG_DIR", claude);
		const market = writeTree(tempDir(), {
			".claude-plugin/marketplace.json": {
				name: "shop",
				plugins: [
					{ name: "alpha", source: "./plugins/alpha", version: "1.0.0", author: { name: "Ada" } },
					{ name: "beta", source: "./plugins/alpha", description: "Beta" },
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
		const marketplace = (tabs: BrowseTab[]) => tabs.find((tab) => tab.id === "marketplace");
		let listed: BrowseTab | undefined;
		const script = scriptedUi([
			// The catalog is fetched in the background; its plugins show without adding the marketplace.
			when(
				(tabs) => {
					listed = marketplace(tabs);
					return row(tabs, "entry:beta@shop") !== undefined;
				},
				{ tab: "marketplace", key: "enter", target: "entry:beta@shop" },
			),
			"yes",
			undefined,
			"later",
		]);
		await managePlugins(script.ui, manager, { reload: vi.fn() });
		expect(script.screens[0]?.[0]?.groups.map((group) => group.label)).toEqual(["In Claude Code"]);
		expect(listed?.groups.map((group) => `${group.label} ${group.right} ${group.badge?.text ?? ""}`)).toEqual([
			"claude-plugins-official Anthropic offline",
			"xai-official xAI offline",
			"shop Claude Code ",
		]);
		expect(
			listed?.groups[2]?.rows.map((entry) => `${entry.label} ${entry.right ?? ""} ${entry.badge?.text ?? ""}`),
		).toEqual(["alpha v1.0.0 by Ada in Claude Code", "beta  "]);
		expect(manager.list().map((plugin) => plugin.source)).toEqual(["beta@shop"]);
		expect(manager.listMarketplaces().map((added) => added.name)).toEqual(["shop"]);
		expect(row(script.screens[1], "entry:beta@shop")?.badge).toEqual({ text: "installed", tone: "success" });
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

	it("signs in with enter on a row that needs it, and opens /mcp's menu with m", async () => {
		const agentDir = tempDir();
		const manager = new PluginManager({ agentDir, cwd: agentDir });
		const { mcp, applyMcp } = fakeMcp("needs-auth");
		const target = "plugin:user:demo";
		const script = scriptedUi([
			{ tab: "plugins", key: "a" },
			demo(),
			"yes",
			{ tab: "plugins", key: "enter", target },
			{ tab: "plugins", key: "m", target },
			undefined,
			"later",
		]);
		await managePlugins(script.ui, manager, { reload: vi.fn(), mcp, applyMcp });
		expect(vi.mocked(mcp.manage).mock.calls.slice(1)).toEqual([
			[["plugin_demo_api"], script.mcpUi, "signin"],
			[["plugin_demo_api"], script.mcpUi],
		]);
	});

	it("stays on the Marketplace tab after updating a plugin from it", async () => {
		const catalog = (version: string) => ({
			".claude-plugin/marketplace.json": {
				name: "shop",
				plugins: [{ name: "alpha", source: "./plugins/alpha", version }],
			},
			"plugins/alpha/plugin.json": { name: "alpha", version },
			"plugins/alpha/commands/a.md": "a",
		});
		const market = writeTree(tempDir(), catalog("1.0.0"));
		const agentDir = tempDir();
		const manager = new PluginManager({ agentDir, cwd: agentDir });
		await manager.addMarketplace(market, {});
		await manager.install("alpha@shop", { trust: true });
		writeTree(market, catalog("2.0.0"));
		await manager.updateMarketplaces("shop");
		const target = "entry:alpha@shop";
		const script = scriptedUi([{ tab: "marketplace", key: "u", target }, undefined, "later"]);
		await managePlugins(script.ui, manager, { reload: vi.fn() });
		expect(script.options[1]?.notice?.text).toMatch(/^Updated alpha/);
		expect(script.options[1]?.focus).toEqual({ tab: "marketplace", key: target });
	});

	it("lists marketplaces the settings declare before their catalogs are fetched, and fetches local ones", async () => {
		const market = writeTree(tempDir(), {
			".claude-plugin/marketplace.json": { name: "acme", plugins: [{ name: "alpha", source: "./plugins/alpha" }] },
			"plugins/alpha/commands/a.md": "a",
		});
		const agentDir = tempDir();
		writeTree(agentDir, {
			"settings.json": {
				pluginMarketplaces: [
					{ name: "acme", source: market },
					{ name: "remote", source: "acme/remote-plugins" },
				],
			},
		});
		const manager = new PluginManager({ agentDir, cwd: agentDir });
		const script = scriptedUi([when((tabs) => row(tabs, "entry:alpha@acme") !== undefined), undefined]);
		await managePlugins(script.ui, manager, { reload: vi.fn() });
		const groups = script.screens[0]?.find((tab) => tab.id === "marketplace")?.groups ?? [];
		// Tests run offline: the GitHub catalog is not fetched, the folder is.
		expect(groups.find((group) => group.label === "remote")?.badge?.text).toBe("offline");
		expect(groups.find((group) => group.label === "acme")?.actions).toMatchObject({ u: "refresh", x: "remove" });
		expect(manager.listMarketplaces().map((added) => added.name)).toEqual(["acme"]);
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
