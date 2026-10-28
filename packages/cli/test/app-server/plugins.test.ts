import { ClientRequests } from "@knightcode/app-server-protocol";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Compile } from "typebox/compile";
import { afterEach, expect, test, vi } from "vitest";
import { writeTree } from "../plugins/helpers.ts";
import { cleanupServers, startServer } from "./harness.ts";

const dirs: string[] = [];
afterEach(async () => {
	await cleanupServers();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const conforms = (method: keyof typeof ClientRequests, result: unknown) =>
	expect(Compile(ClientRequests[method].result).Check(result), method).toBe(true);

function pluginSource(): string {
	const dir = mkdtempSync(join(tmpdir(), "kc-app-plugin-"));
	dirs.push(dir);
	return writeTree(dir, {
		"plugin.json": {
			name: "demo",
			description: "Demo",
			mcpServers: { api: { command: "node", env: { T: "${API_TOKEN}" } } },
		},
		"commands/go.md": "---\ndescription: Go\n---\nGo $0",
		"skills/fix/SKILL.md": "---\ndescription: Fix it\n---\nFix",
	});
}

test("installs untrusted, activates on trust, updates and uninstalls", async () => {
	const { cwd, connect } = await startServer();
	const a = await connect();
	const empty = await a.client.request("plugin/list", { cwd });
	conforms("plugin/list", empty);
	expect(empty.plugins).toEqual([]);
	const installed = await a.client.request("plugin/install", { scope: "global", cwd, source: pluginSource() });
	conforms("plugin/install", installed);
	expect(installed.plugin).toMatchObject({
		name: "demo",
		scope: "global",
		trusted: false,
		active: false,
		commands: ["demo:go"],
		skills: ["demo:fix"],
		mcpServers: [{ name: "api", target: "node" }],
		environment: ["API_TOKEN"],
	});
	const trusted = await a.client.request("plugin/set", { scope: "global", cwd, name: "demo", trust: true });
	conforms("plugin/set", trusted);
	expect(trusted.plugin).toMatchObject({ trusted: true, active: true });
	const update = await a.client.request("plugin/update", { scope: "global", cwd, name: "demo" });
	conforms("plugin/update", update);
	expect(update.changed).toBe(false);
	await a.client.request("plugin/set", { scope: "global", cwd, name: "demo", enabled: false });
	expect((await a.client.request("plugin/list", { cwd })).plugins[0]).toMatchObject({ enabled: false, active: false });
	conforms("plugin/uninstall", await a.client.request("plugin/uninstall", { scope: "global", cwd, name: "demo" }));
	expect((await a.client.request("plugin/list", { cwd })).plugins).toEqual([]);
});

test("rejects project writes in an untrusted project", async () => {
	const { cwd, connect } = await startServer();
	const a = await connect();
	await expect(
		a.client.request("plugin/install", { scope: "project", cwd, source: pluginSource(), trust: true }),
	).rejects.toMatchObject({ code: "invalidParams", data: { reason: "untrusted" } });
	await expect(a.client.request("plugin/install", { scope: "project", source: pluginSource() })).rejects.toMatchObject({
		code: "invalidParams",
	});
	await a.client.request("project/trust/set", { cwd, trusted: true });
	const local = await a.client.request("plugin/install", {
		scope: "project",
		cwd,
		source: pluginSource(),
		trust: true,
	});
	expect(local.plugin).toMatchObject({ scope: "project", active: true });
});

test("lists plugin commands for a cwd before any thread exists, without starting MCP servers", async () => {
	const { cwd, connect } = await startServer();
	const a = await connect();
	await a.client.request("plugin/install", { scope: "global", cwd, source: pluginSource(), trust: true });
	const listed = await a.client.request("command/list", { cwd });
	conforms("command/list", listed);
	const names = listed.commands.map((command) => command.name);
	expect(names).toEqual(expect.arrayContaining(["demo:go", "demo:fix", "skill:demo:fix"]));
	expect(names).not.toContain("plugins");
	expect(listed.commands.find((command) => command.name === "demo:go")?.description).toBe("Go");
});

test("adds marketplaces without installing, and installs from them", async () => {
	const { cwd, connect } = await startServer();
	const a = await connect();
	const dir = mkdtempSync(join(tmpdir(), "kc-app-market-"));
	dirs.push(dir);
	writeTree(dir, {
		".claude-plugin/marketplace.json": {
			name: "shop",
			plugins: [{ name: "alpha", source: "./alpha", description: "A" }],
		},
		"alpha/commands/a.md": "a",
	});
	const added = await a.client.request("plugin/marketplace/add", { scope: "global", cwd, source: dir });
	conforms("plugin/marketplace/add", added);
	expect(added.marketplace).toMatchObject({ name: "shop", plugins: [{ name: "alpha", installed: false }] });
	expect((await a.client.request("plugin/list", { cwd })).plugins).toEqual([]);
	await a.client.request("plugin/install", { scope: "global", cwd, source: "alpha@shop", trust: true });
	const markets = await a.client.request("plugin/marketplace/list", { cwd });
	conforms("plugin/marketplace/list", markets);
	expect(markets.marketplaces[0]?.plugins[0]).toMatchObject({ name: "alpha", installed: true });
	conforms("plugin/marketplace/update", await a.client.request("plugin/marketplace/update", { cwd }));
	await a.client.request("plugin/marketplace/remove", { scope: "global", cwd, name: "shop" });
	expect((await a.client.request("plugin/marketplace/list", { cwd })).marketplaces).toEqual([]);
	expect((await a.client.request("plugin/list", { cwd })).plugins).toHaveLength(1);
});

test("offers Claude Code's installs and the known marketplaces, and imports through the marketplace", async () => {
	const claude = mkdtempSync(join(tmpdir(), "kc-app-claude-"));
	const market = mkdtempSync(join(tmpdir(), "kc-app-market-"));
	dirs.push(claude, market);
	vi.stubEnv("CLAUDE_CONFIG_DIR", claude);
	writeTree(market, {
		".claude-plugin/marketplace.json": { name: "shop", plugins: [{ name: "alpha", source: "./alpha" }] },
		"alpha/commands/a.md": "a",
	});
	writeTree(claude, {
		"plugins/known_marketplaces.json": { shop: { source: { source: "directory", path: market } } },
		"plugins/installed_plugins.json": { version: 2, plugins: { "alpha@shop": [{ scope: "user", installPath: "x" }] } },
	});
	const { cwd, connect } = await startServer();
	const a = await connect();
	const listed = await a.client.request("plugin/list", { cwd });
	conforms("plugin/list", listed);
	expect(listed.importable).toEqual([{ name: "alpha", from: "Claude Code", source: "alpha@shop", enabled: true }]);
	const markets = await a.client.request("plugin/marketplace/list", { cwd });
	conforms("plugin/marketplace/list", markets);
	expect(markets.available).toEqual([
		{ name: "claude-plugins-official", source: "anthropics/claude-plugins-official", from: "Anthropic" },
		{ name: "xai-official", source: "xai-org/plugin-marketplace", from: "xAI" },
		{ name: "shop", source: market, from: "Claude Code" },
	]);
	const imported = await a.client.request("plugin/install", { scope: "global", cwd, source: "alpha@shop" });
	expect(imported.plugin).toMatchObject({ name: "alpha", marketplace: "shop", trusted: false });
	const after = await a.client.request("plugin/marketplace/list", { cwd });
	expect(after.marketplaces.map((added) => added.name)).toEqual(["shop"]);
	expect(after.available.map((known) => known.name)).toEqual(["claude-plugins-official", "xai-official"]);
	expect((await a.client.request("plugin/list", { cwd })).importable).toEqual([]);
});
