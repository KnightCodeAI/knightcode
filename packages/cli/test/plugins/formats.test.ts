import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPlugin, sanitizePluginName } from "../../src/plugins/manifest.ts";
import { readMarketplace } from "../../src/plugins/marketplace.ts";
import { useTempDirs, writeTree } from "./helpers.ts";

const tempDir = useTempDirs();
const skill = (description = "Does a thing.") => `---\ndescription: ${description}\n---\nBody\n`;

describe("plugin names", () => {
	it("sanitizes manifest names into namespaces", () => {
		expect(sanitizePluginName("My_Plugin.v2")).toBe("my-plugin-v2");
		expect(sanitizePluginName("--Edge--")).toBe("edge");
		expect(sanitizePluginName("x".repeat(80))).toBe("x".repeat(64));
		expect(sanitizePluginName("!!!")).toBeUndefined();
	});
});

describe("plugin manifests", () => {
	it("prefers plugin.json over .grok-plugin and .claude-plugin, without merging", () => {
		const root = writeTree(tempDir(), {
			"plugin.json": { name: "top" },
			".grok-plugin/plugin.json": { name: "grok", description: "ignored" },
			".claude-plugin/plugin.json": { name: "claude" },
		});
		const plugin = loadPlugin(root);
		expect(plugin.displayName).toBe("top");
		expect(plugin.description).toBeUndefined();
		expect(plugin.manifestPath).toBe(join(root, "plugin.json"));
	});

	it("falls back to .claude-plugin/plugin.json and keeps the display name", () => {
		const root = writeTree(tempDir(), { ".claude-plugin/plugin.json": { name: "Code_Review", version: "1.2.0" } });
		const plugin = loadPlugin(root);
		expect(plugin.displayName).toBe("Code_Review");
		expect(plugin.namespace).toBe("code-review");
		expect(plugin.version).toBe("1.2.0");
	});

	it("treats a directory with conventional components as a plugin named after the directory", () => {
		const parent = tempDir();
		const root = writeTree(join(parent, "Lint Tools"), { "skills/fix/SKILL.md": skill() });
		const plugin = loadPlugin(root);
		expect(plugin.manifestPath).toBeUndefined();
		expect(plugin.namespace).toBe("lint-tools");
		expect(plugin.components.skills).toEqual([join(root, "skills")]);
	});

	it("rejects a directory that is not a plugin, and a malformed manifest", () => {
		expect(() => loadPlugin(writeTree(tempDir(), { "README.md": "hi" }))).toThrow(/not a plugin/);
		expect(() => loadPlugin(writeTree(tempDir(), { "plugin.json": "{ nope" }))).toThrow(/plugin\.json/);
		expect(() => loadPlugin(writeTree(tempDir(), { "plugin.json": { name: "" } }))).toThrow(/name/);
	});

	it("lets manifest component fields replace the conventional directories", () => {
		const root = writeTree(tempDir(), {
			"plugin.json": { name: "p", skills: "./extra-skills", commands: ["./cmds/one.md"] },
			"skills/a/SKILL.md": skill(),
			"extra-skills/b/SKILL.md": skill(),
			"commands/old.md": "old",
			"cmds/one.md": "one",
		});
		const { components } = loadPlugin(root);
		expect(components.skills).toEqual([join(root, "extra-skills")]);
		expect(components.commands).toEqual([{ path: join(root, "cmds/one.md") }]);
	});

	it("treats an explicit empty array as no components", () => {
		const root = writeTree(tempDir(), {
			"plugin.json": { name: "p", skills: [], commands: [] },
			"skills/a/SKILL.md": skill(),
			"commands/x.md": "x",
		});
		const { components } = loadPlugin(root);
		expect(components.skills).toEqual([]);
		expect(components.commands).toEqual([]);
	});

	it("reads command records with source and inline content", () => {
		const root = writeTree(tempDir(), {
			"plugin.json": {
				name: "p",
				commands: {
					review: { source: "./prompts/review.md", description: "Review", "argument-hint": "<file>" },
					hello: { content: "Say hello to $0" },
				},
			},
			"prompts/review.md": "Review it",
		});
		expect(loadPlugin(root).components.commands).toEqual([
			{ name: "review", path: join(root, "prompts/review.md"), description: "Review", argumentHint: "<file>" },
			{ name: "hello", content: "Say hello to $0" },
		]);
	});

	it("merges MCP paths and inline maps in order, later definitions winning", () => {
		const root = writeTree(tempDir(), {
			"plugin.json": {
				name: "p",
				mcpServers: ["./mcp/a.json", { b: { command: "inline-b" }, c: { command: "inline-c" } }, "./mcp/c.json"],
			},
			"mcp/a.json": { mcpServers: { a: { command: "a" }, b: { command: "file-b" } } },
			"mcp/c.json": { c: { command: "file-c" } },
		});
		expect(loadPlugin(root).components.mcpServers).toEqual({
			a: { command: "a" },
			b: { command: "inline-b" },
			c: { command: "file-c" },
		});
	});

	it("keeps a sibling .mcp.json next to an inline map, in both shapes", () => {
		const wrapped = writeTree(tempDir(), {
			"plugin.json": { name: "p", mcpServers: { mcpServers: { inline: { command: "i" } } } },
			".mcp.json": { mcpServers: { file: { command: "f" } } },
		});
		expect(loadPlugin(wrapped).components.mcpServers).toEqual({ file: { command: "f" }, inline: { command: "i" } });
		const bare = writeTree(tempDir(), { ".mcp.json": { file: { url: "https://example.com/mcp" } } });
		expect(loadPlugin(bare).components.mcpServers).toEqual({ file: { url: "https://example.com/mcp" } });
	});

	it("reports MCPB paths and URLs as unsupported", () => {
		const root = writeTree(tempDir(), {
			"plugin.json": { name: "p", mcpServers: ["./server.mcpb", "https://example.com/servers.json"] },
		});
		const plugin = loadPlugin(root);
		expect(plugin.components.mcpServers).toEqual({});
		expect(plugin.diagnostics.join("\n")).toMatch(/server\.mcpb/);
		expect(plugin.diagnostics.join("\n")).toMatch(/https:\/\/example\.com/);
	});

	it("lists unsupported components from the manifest and conventional locations", () => {
		const root = writeTree(tempDir(), {
			"plugin.json": { name: "p", hooks: "./hooks.json", userConfig: {}, dependencies: ["x"], lspServers: {} },
			"agents/reviewer.md": "agent",
			"output-styles/terse.md": "style",
		});
		expect(loadPlugin(root).components.unsupported.sort()).toEqual(
			["agents", "dependencies", "hooks", "lspServers", "outputStyles", "userConfig"].sort(),
		);
	});

	it("rejects component paths that escape the plugin root", () => {
		const root = writeTree(tempDir(), { "plugin.json": { name: "p", skills: ["../outside", "/etc"] } });
		const plugin = loadPlugin(root);
		expect(plugin.components.skills).toEqual([]);
		expect(plugin.diagnostics.join("\n")).toMatch(/outside/);
	});

	it("rejects symlinks and junctions that leave the plugin root", () => {
		const outside = writeTree(tempDir(), { "x/SKILL.md": skill() });
		const root = writeTree(tempDir(), { "plugin.json": { name: "p", skills: ["./linked"] } });
		symlinkSync(outside, join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
		const plugin = loadPlugin(root);
		expect(plugin.components.skills).toEqual([]);
		expect(plugin.diagnostics.join("\n")).toMatch(/linked/);
	});
});

describe("marketplace catalogs", () => {
	const catalog = (plugins: unknown[]) => ({ name: "market", owner: { name: "o" }, plugins });

	it("probes .grok-plugin before .claude-plugin, and plugin.json only as a catalog with plugins", () => {
		const root = writeTree(tempDir(), {
			".grok-plugin/plugin.json": { name: "just-a-plugin" },
			".claude-plugin/marketplace.json": catalog([{ name: "a", source: "./a" }]),
		});
		expect(readMarketplace(root).catalogPath).toBe(join(root, ".claude-plugin/marketplace.json"));
		const grok = writeTree(tempDir(), {
			".grok-plugin/plugin.json": catalog([{ name: "g", source: "./g" }]),
			".claude-plugin/marketplace.json": catalog([]),
		});
		expect(readMarketplace(grok).catalogPath).toBe(join(grok, ".grok-plugin/plugin.json"));
		expect(() => readMarketplace(tempDir())).toThrow(/marketplace/);
	});

	it("parses every supported source form and rejects the others", () => {
		const root = writeTree(tempDir(), {
			".claude-plugin/marketplace.json": catalog([
				{ name: "rel", source: "./plugins/rel" },
				{ name: "local", source: { type: "local", path: "plugins/local" } },
				{ name: "gh", source: { source: "github", repo: "acme/tools", ref: "v1" } },
				{
					name: "url",
					source: { source: "url", url: "https://git.example.com/x.git", path: "sub", sha: "a".repeat(40) },
				},
				{ name: "sub", source: { type: "git-subdir", url: "https://git.example.com/y.git", path: "pkg/p" } },
				{ name: "npm", source: { source: "npm", package: "x" } },
				{ name: "pip", source: { source: "pip", package: "x" } },
			]),
		});
		const market = readMarketplace(root);
		expect(market.name).toBe("market");
		expect(market.plugins.map((entry) => [entry.name, entry.source])).toEqual([
			["rel", { kind: "local", path: "./plugins/rel" }],
			["local", { kind: "local", path: "plugins/local" }],
			["gh", { kind: "git", url: "https://github.com/acme/tools.git", ref: "v1" }],
			["url", { kind: "git", url: "https://git.example.com/x.git", path: "sub", sha: "a".repeat(40) }],
			["sub", { kind: "git", url: "https://git.example.com/y.git", path: "pkg/p" }],
		]);
		expect(market.diagnostics.join("\n")).toMatch(/npm.*unsupported source/);
		expect(market.diagnostics.join("\n")).toMatch(/pip.*unsupported source/);
	});

	it("adds entry components to a manifest-less plugin and takes its metadata and MCP servers", () => {
		const root = writeTree(tempDir(), {
			"commands/conventional.md": "c",
			"more/extra.md": "e",
		});
		const plugin = loadPlugin(root, {
			name: "From-Entry",
			description: "entry description",
			strict: true,
			raw: { commands: ["./more/extra.md"], mcpServers: { s: { command: "s" } } },
		});
		expect(plugin.namespace).toBe("from-entry");
		expect(plugin.description).toBe("entry description");
		expect(plugin.components.commands).toEqual([
			{ path: join(root, "commands") },
			{ path: join(root, "more/extra.md") },
		]);
		expect(plugin.components.mcpServers).toEqual({ s: { command: "s" } });
	});

	it("adds a strict entry's skills to the manifest's and ignores its MCP servers", () => {
		const root = writeTree(tempDir(), {
			"plugin.json": { name: "p", skills: ["./a"] },
			"a/SKILL.md": skill(),
			"b/SKILL.md": skill(),
		});
		const plugin = loadPlugin(root, {
			name: "p",
			strict: true,
			raw: { skills: ["./b"], mcpServers: { s: { command: "s" } }, agents: ["./x.md"] },
		});
		expect(plugin.components.skills).toEqual([join(root, "a"), join(root, "b")]);
		expect(plugin.components.mcpServers).toEqual({});
		expect(plugin.components.unsupported).toContain("agents");
	});

	it("rejects a non-strict entry that declares components next to a manifest, but not MCP servers alone", () => {
		const root = writeTree(tempDir(), { "plugin.json": { name: "p" }, "commands/x.md": "x" });
		expect(() => loadPlugin(root, { name: "p", strict: false, raw: { commands: ["./y.md"] } })).toThrow(/conflict/);
		const plugin = loadPlugin(root, { name: "p", strict: false, raw: { mcpServers: { s: { command: "s" } } } });
		expect(plugin.components.mcpServers).toEqual({ s: { command: "s" } });
	});

	it("keeps sibling directories out of single-file components", () => {
		const root = tempDir();
		mkdirSync(join(root, "skills"));
		writeTree(root, { "plugin.json": { name: "p", skills: ["./skills/one.md"] }, "skills/one.md": skill() });
		expect(loadPlugin(root).components.skills).toEqual([join(root, "skills/one.md")]);
	});
});
