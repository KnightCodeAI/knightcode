import { ClientRequests } from "@knightcode/app-server-protocol";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

test("lists plugin commands for a cwd before any thread exists", async () => {
	const { cwd, connect } = await startServer();
	const a = await connect();
	await a.client.request("plugin/install", { scope: "global", cwd, source: pluginSource(), trust: true });
	const listed = await a.client.request("command/list", { cwd });
	conforms("command/list", listed);
	const names = listed.commands.map((command) => command.name);
	expect(names).toEqual(expect.arrayContaining(["demo:go", "demo:fix"]));
	// The skill is offered once, as the plugin's own command.
	expect(names).not.toContain("skill:demo:fix");
	expect(names).not.toContain("plugins");
	expect(listed.commands.find((command) => command.name === "demo:go")?.description).toBe("Go");
});

test("lists no plugin commands for a cwd when settings turn the plugins extension off", async () => {
	const { cwd, agentDir, connect } = await startServer();
	const a = await connect();
	await a.client.request("plugin/install", { scope: "global", cwd, source: pluginSource(), trust: true });
	const path = join(agentDir, "settings.json");
	writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, "utf-8")), extensions: ["-builtin:plugins"] }));
	const names = (await a.client.request("command/list", { cwd })).commands.map((command) => command.name);
	expect(names).not.toContain("demo:go");
	// As the thread started there offers.
	const { thread } = await a.client.request("thread/start", { cwd });
	const started = (await a.client.request("command/list", { threadId: thread.id })).commands;
	expect(started.map((command) => command.name)).not.toContain("demo:go");
});

test("loads a thread's plugins from the server's agent directory", async () => {
	const { cwd, agentDir, connect } = await startServer();
	const a = await connect();
	const dir = mkdtempSync(join(tmpdir(), "kc-app-plugin-"));
	dirs.push(dir);
	const source = writeTree(dir, {
		"plugin.json": { name: "local" },
		"commands/hi.md": "---\ndescription: Hi\n---\nHi",
	});
	// A user skill that shares a built-in command's name keeps its own `/skill:` entry.
	writeTree(agentDir, { "skills/plan/SKILL.md": "---\nname: plan\ndescription: Mine\n---\nMine" });
	await a.client.request("plugin/install", { scope: "global", cwd, source, trust: true });
	const { thread } = await a.client.request("thread/start", { cwd });
	const { commands } = await a.client.request("command/list", { threadId: thread.id });
	const names = commands.map((command) => command.name);
	expect(names).toEqual(expect.arrayContaining(["local:hi", "plan", "skill:plan"]));
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
	expect(markets.marketplaces.find((market) => market.name === "shop")).toMatchObject({
		added: true,
		scope: "global",
		plugins: [{ name: "alpha", installed: true, update: false }],
	});
	conforms("plugin/marketplace/update", await a.client.request("plugin/marketplace/update", { cwd }));
	await a.client.request("plugin/marketplace/remove", { scope: "global", cwd, name: "shop" });
	const left = (await a.client.request("plugin/marketplace/list", { cwd })).marketplaces;
	expect(left.map((market) => market.name)).toEqual(["claude-plugins-official", "xai-official"]);
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
	const list = async () => (await a.client.request("plugin/marketplace/list", { cwd })).marketplaces;
	const markets = await a.client.request("plugin/marketplace/list", { cwd });
	conforms("plugin/marketplace/list", markets);
	expect(
		markets.marketplaces.map(({ name, source, from, added, missing, plugins }) => ({
			name,
			source,
			from,
			added,
			missing,
			plugins: plugins.length,
		})),
	).toEqual([
		{
			name: "claude-plugins-official",
			source: "anthropics/claude-plugins-official",
			from: "Anthropic",
			added: false,
			missing: true,
			plugins: 0,
		},
		{
			name: "xai-official",
			source: "xai-org/plugin-marketplace",
			from: "xAI",
			added: false,
			missing: true,
			plugins: 0,
		},
		{ name: "shop", source: market, from: "Claude Code", added: false, missing: true, plugins: 0 },
	]);
	// Fetching a catalog to browse it adds nothing.
	conforms("plugin/marketplace/update", await a.client.request("plugin/marketplace/update", { cwd, name: "shop" }));
	expect((await list()).find((row) => row.name === "shop")).toMatchObject({
		added: false,
		plugins: [{ name: "alpha", installed: false }],
	});
	const imported = await a.client.request("plugin/install", { scope: "global", cwd, source: "alpha@shop" });
	expect(imported.plugin).toMatchObject({ name: "alpha", marketplace: "shop", trusted: false });
	// The plugin's row says it is not trusted; the terminal's hint to trust it is not repeated as a problem.
	expect((await a.client.request("plugin/list", { cwd })).diagnostics).toEqual([]);
	expect((await list()).find((row) => row.name === "shop")).toMatchObject({
		added: true,
		plugins: [{ name: "alpha", installed: true }],
	});
	expect((await a.client.request("plugin/list", { cwd })).importable).toEqual([]);
});
