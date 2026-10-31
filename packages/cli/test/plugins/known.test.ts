import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { foreignPlugins, knownMarketplaces, toolClones } from "../../src/plugins/known.ts";
import { PluginManager } from "../../src/plugins/manager.ts";
import { useTempDirs, writeTree } from "./helpers.ts";

const tempDir = useTempDirs();
let claude: string;
let grok: string;

beforeEach(() => {
	claude = tempDir();
	grok = tempDir();
	vi.stubEnv("CLAUDE_CONFIG_DIR", claude);
	vi.stubEnv("GROK_HOME", grok);
});

/** A local marketplace named `name` with one plugin, `alpha`. */
function shop(name = "shop"): string {
	return writeTree(tempDir(), {
		".claude-plugin/marketplace.json": { name, plugins: [{ name: "alpha", source: "./plugins/alpha" }] },
		"plugins/alpha/commands/a.md": "a",
	});
}

function setup() {
	const agentDir = tempDir();
	const manager = () => new PluginManager({ agentDir, cwd: tempDir() });
	const userSettings = () => {
		const path = join(agentDir, "settings.json");
		return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : {};
	};
	return { manager, userSettings };
}

describe("known marketplaces", () => {
	it("offers Anthropic's and xAI's catalogs first, then Claude Code's and Grok Build's, once per repository", () => {
		const local = tempDir();
		writeTree(claude, {
			"plugins/known_marketplaces.json": {
				"claude-plugins-official": {
					source: { source: "github", repo: "anthropics/claude-plugins-official" },
					installLocation: "anywhere",
				},
				ponytail: { source: { source: "github", repo: "DietrichGebert/ponytail" } },
				remote: { source: { source: "url", url: "https://example.com/marketplace.json" } },
			},
			"settings.json": {
				extraKnownMarketplaces: {
					team: { source: { source: "git", url: "https://git.example.com/team/plugins.git", ref: "stable" } },
				},
			},
		});
		writeTree(grok, {
			"plugins/known_marketplaces.json": {
				mine: { source: { source: "local", path: local } },
				again: { source: { source: "git", url: "https://github.com/xai-org/plugin-marketplace.git" } },
			},
		});
		expect(knownMarketplaces()).toEqual([
			{ name: "claude-plugins-official", source: "anthropics/claude-plugins-official", from: "Anthropic" },
			{ name: "xai-official", source: "xai-org/plugin-marketplace", from: "xAI" },
			{ name: "team", source: "https://git.example.com/team/plugins.git", ref: "stable", from: "Claude Code" },
			{ name: "ponytail", source: "DietrichGebert/ponytail", from: "Claude Code" },
			{ name: "mine", source: local, from: "Grok Build" },
		]);
	});

	it("lists the plugins Claude Code and Grok Build installed for the user", () => {
		writeTree(claude, {
			"plugins/installed_plugins.json": {
				version: 2,
				plugins: {
					"superpowers@claude-plugins-official": [{ scope: "user", installPath: "a" }],
					"expo@claude-plugins-official": [{ scope: "local", projectPath: "/elsewhere", installPath: "b" }],
					"claude-mem@thedotmack": [{ scope: "user", installPath: "c" }],
				},
			},
			"plugins/known_marketplaces.json": {
				thedotmack: { source: { source: "github", repo: "thedotmack/claude-mem" } },
			},
			"settings.json": { enabledPlugins: { "claude-mem@thedotmack": false } },
		});
		writeTree(grok, {
			"installed-plugins/registry.json": {
				version: 1,
				repos: {
					"skills-1": {
						kind: { type: "Git", url: "https://github.com/cloudflare/skills.git" },
						plugins: { cloudflare: { version: "1.0.0" } },
						marketplace: {
							source_url_or_path: "https://github.com/xai-org/plugin-marketplace.git",
							source_display_name: "xAI Official",
						},
					},
					"direct-1": { kind: { type: "Git", url: "https://github.com/a/b.git" }, plugins: { direct: {} } },
				},
			},
		});
		expect(foreignPlugins()).toEqual([
			{ name: "superpowers", from: "Claude Code", marketplace: { name: "claude-plugins-official" }, enabled: true },
			{
				name: "claude-mem",
				from: "Claude Code",
				marketplace: { name: "thedotmack", source: "thedotmack/claude-mem" },
				enabled: false,
			},
			{
				name: "cloudflare",
				from: "Grok Build",
				marketplace: { source: "https://github.com/xai-org/plugin-marketplace.git" },
				enabled: true,
			},
			{ name: "direct", from: "Grok Build", marketplace: {}, enabled: true },
		]);
	});

	it("reads nothing when neither tool is set up", () => {
		expect(foreignPlugins()).toEqual([]);
		expect(knownMarketplaces().map((market) => market.name)).toEqual(["claude-plugins-official", "xai-official"]);
	});
});

describe("marketplaces and plugins from Claude Code and Grok Build", () => {
	it("offers each known marketplace until it is added, and adds one by name", async () => {
		const { manager, userSettings } = setup();
		const market = shop();
		writeTree(claude, {
			"plugins/known_marketplaces.json": { shop: { source: { source: "directory", path: market } } },
		});
		expect(manager().availableMarketplaces()).toEqual([
			{ name: "claude-plugins-official", source: "anthropics/claude-plugins-official", from: "Anthropic" },
			{ name: "xai-official", source: "xai-org/plugin-marketplace", from: "xAI" },
			{ name: "shop", source: market, from: "Claude Code" },
		]);
		const added = await manager().addMarketplace("shop", {});
		expect(added.plugins.map((entry) => entry.name)).toEqual(["alpha"]);
		expect(userSettings().pluginMarketplaces).toEqual([{ name: "shop", source: market }]);
		expect(
			manager()
				.availableMarketplaces()
				.map((known) => known.name),
		).toEqual(["claude-plugins-official", "xai-official"]);
	});

	it("imports a plugin Claude Code installed: adds its marketplace, still asks for trust, then stops offering it", async () => {
		const { manager } = setup();
		writeTree(claude, {
			"plugins/known_marketplaces.json": { shop: { source: { source: "directory", path: shop() } } },
			"plugins/installed_plugins.json": {
				version: 2,
				plugins: { "alpha@shop": [{ scope: "user", installPath: "x" }] },
			},
		});
		expect(manager().importablePlugins()).toEqual([
			{ name: "alpha", from: "Claude Code", source: "alpha@shop", enabled: true },
		]);
		const confirm = vi.fn(async () => false);
		const { trusted } = await manager().install("alpha@shop", { confirm });
		expect(confirm).toHaveBeenCalledOnce();
		expect(trusted).toBe(false);
		expect(manager().loadActive(false).plugins).toEqual([]);
		expect(
			manager()
				.listMarketplaces()
				.map((market) => market.name),
		).toEqual(["shop"]);
		expect(manager().importablePlugins()).toEqual([]);
	});

	it("maps a Grok Build install to the marketplace with the same repository, and skips ones it cannot name", () => {
		const { manager } = setup();
		writeTree(grok, {
			"installed-plugins/registry.json": {
				version: 1,
				repos: {
					one: {
						plugins: { cloudflare: {} },
						marketplace: { source_url_or_path: "https://github.com/xai-org/plugin-marketplace.git" },
					},
					two: { plugins: { stray: {} }, marketplace: { source_url_or_path: "https://git.example.com/unknown.git" } },
					three: { plugins: { direct: {} } },
				},
			},
		});
		expect(manager().importablePlugins()).toEqual([
			{ name: "cloudflare", from: "Grok Build", source: "cloudflare@xai-official", enabled: true },
		]);
	});

	it("shows a catalog at once from Claude Code's and Grok Build's own copies, before fetching", () => {
		const { manager } = setup();
		const catalog = (name: string, plugin: string) => ({
			".claude-plugin/marketplace.json": { name, plugins: [{ name: plugin, source: "./plugins/x" }] },
		});
		const clone = writeTree(tempDir(), catalog("ponytail", "ponytail"));
		writeTree(claude, {
			"plugins/known_marketplaces.json": {
				ponytail: { source: { source: "github", repo: "DietrichGebert/ponytail" }, installLocation: clone },
			},
		});
		writeTree(grok, {
			"marketplace-cache/c6b314fa/.git/config":
				'[core]\n\tbare = false\n[remote "origin"]\n\turl = https://github.com/xai-org/plugin-marketplace.git\n',
			...Object.fromEntries(
				Object.entries(catalog("xai-official", "cloudflare")).map(([path, value]) => [
					`marketplace-cache/c6b314fa/${path}`,
					value,
				]),
			),
		});
		const listed = manager()
			.browseMarketplaces()
			.map((listing) => `${listing.name} ${listing.missing === true} ${listing.plugins.map((plugin) => plugin.name)}`);
		expect(listed).toEqual([
			"claude-plugins-official true ",
			"xai-official false cloudflare",
			"ponytail false ponytail",
		]);
	});

	it("reads a Grok Build clone's Git config in linear time", () => {
		// Under the `m` flag the old `^\s*url` spanned blank lines, quadratic on a long run of them (about 5 s here).
		writeTree(grok, {
			"marketplace-cache/c6b314fa/.git/config": `${"\n".repeat(100_000)}[remote "origin"]\n\turl = https://github.com/xai-org/plugin-marketplace.git\n`,
		});
		const start = performance.now();
		expect([...toolClones().keys()]).toEqual(["https://github.com/xai-org/plugin-marketplace"]);
		expect(performance.now() - start).toBeLessThan(1000);
	});

	it("browses a known marketplace from KnightCode's cache without adding it, and marks updates", async () => {
		const { manager, userSettings } = setup();
		const entry = (version: string) => ({
			name: "alpha",
			source: "./plugins/alpha",
			version,
			author: { name: "Ada" },
		});
		const market = writeTree(tempDir(), {
			".claude-plugin/marketplace.json": { name: "shop", plugins: [entry("1.0.0")] },
			"plugins/alpha/plugin.json": { name: "alpha", version: "1.0.0" },
			"plugins/alpha/commands/a.md": "a",
		});
		writeTree(claude, {
			"plugins/known_marketplaces.json": { shop: { source: { source: "directory", path: market } } },
		});
		const shop = () =>
			manager()
				.browseMarketplaces()
				.find((listing) => listing.name === "shop");
		expect(
			manager()
				.browseMarketplaces()
				.map((listing) => `${listing.name} ${listing.from} ${listing.added} ${listing.missing === true}`),
		).toEqual([
			"claude-plugins-official Anthropic false true",
			"xai-official xAI false true",
			"shop Claude Code false true",
		]);
		await manager().cacheMarketplace({ source: market });
		expect(shop()).toMatchObject({
			added: false,
			plugins: [{ name: "alpha", version: "1.0.0", author: "Ada", installed: false, update: false }],
		});
		expect(userSettings().pluginMarketplaces).toBeUndefined();
		await manager().install("alpha@shop", { trust: true });
		expect(shop()).toMatchObject({ added: true, plugins: [{ installed: true, update: false }] });
		writeTree(market, { ".claude-plugin/marketplace.json": { name: "shop", plugins: [entry("2.0.0")] } });
		await manager().updateMarketplaces("shop");
		expect(shop()?.plugins[0]).toMatchObject({ installed: true, update: true });
	});

	it("still refuses a marketplace it does not know", async () => {
		const { manager } = setup();
		await expect(manager().install("alpha@nowhere", {})).rejects.toThrow(/marketplace add/);
		await expect(manager().addMarketplace("nowhere", {})).rejects.toThrow(/unrecognized source/);
	});
});
