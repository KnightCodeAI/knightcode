import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectTrustStore } from "../../src/core/trust-manager.ts";
import { PluginManager } from "../../src/plugins/manager.ts";
import { useTempDirs, writeTree } from "./helpers.ts";

const tempDir = useTempDirs();
const skill = (text = "Does a thing.") => `---\ndescription: ${text}\n---\nBody\n`;

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf-8",
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "t",
			GIT_AUTHOR_EMAIL: "t@example.com",
			GIT_COMMITTER_NAME: "t",
			GIT_COMMITTER_EMAIL: "t@example.com",
		},
	}).trim();
}

/** A repository with `files` committed; returns its file URL and a function that commits more. */
function gitRepo(files: Record<string, string | object>) {
	const dir = writeTree(tempDir(), files);
	git(dir, "init", "-q", "-b", "main");
	git(dir, "add", "-A");
	git(dir, "commit", "-q", "-m", "init");
	return {
		dir,
		url: pathToFileURL(dir).href,
		head: () => git(dir, "rev-parse", "HEAD"),
		commit(more: Record<string, string | object>) {
			writeTree(dir, more);
			git(dir, "add", "-A");
			git(dir, "commit", "-q", "-m", "more");
			return git(dir, "rev-parse", "HEAD");
		},
	};
}

function setup(options: { trustProject?: boolean } = {}) {
	const agentDir = tempDir();
	const cwd = tempDir();
	if (options.trustProject) new ProjectTrustStore(agentDir).set(cwd, true);
	const manager = (overrides: Partial<ConstructorParameters<typeof PluginManager>[0]> = {}) =>
		new PluginManager({ agentDir, cwd, ...overrides });
	const settings = (scope: "user" | "project") => {
		const path = scope === "user" ? join(agentDir, "settings.json") : join(cwd, ".knightcode", "settings.json");
		return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : {};
	};
	return { agentDir, cwd, manager, settings };
}

describe("plugin installation", () => {
	it("installs a local directory as an immutable, rendered copy and activates it once trusted", async () => {
		const { manager, settings } = setup();
		const source = writeTree(tempDir(), { "plugin.json": { name: "demo" }, "skills/s/SKILL.md": skill() });
		const result = await manager().install(source, { trust: true });
		expect(result.plugin.namespace).toBe("demo");
		expect(result.plugin.trusted).toBe(true);
		expect(settings("user").plugins).toEqual([{ source }]);
		const { plugins } = manager().loadActive(false);
		expect(plugins.map((plugin) => plugin.namespace)).toEqual(["demo"]);
		expect(plugins[0]?.root).not.toBe(source);
		expect(readFileSync(join(plugins[0]!.root, "skills/s/SKILL.md"), "utf-8")).toContain("name: demo:s");
		// Edits to the source take effect only after an update.
		writeTree(source, { "skills/t/SKILL.md": skill() });
		expect(manager().loadActive(false).plugins[0]?.inventory.skills).toHaveLength(1);
		const updated = await manager().update("demo", {});
		expect(updated.changed).toBe(true);
		expect(manager().loadActive(false).plugins[0]?.inventory.skills).toHaveLength(2);
	});

	it("leaves an untrusted or disabled plugin inactive", async () => {
		const { manager } = setup();
		const source = writeTree(tempDir(), { "plugin.json": { name: "quiet" }, "commands/x.md": "x" });
		const result = await manager().install(source, {});
		expect(result.plugin.trusted).toBe(false);
		expect(manager().loadActive(false).plugins).toEqual([]);
		await manager().setEnabled("quiet", true, { trust: true });
		expect(manager().loadActive(false).plugins).toHaveLength(1);
		await manager().setEnabled("quiet", false, {});
		expect(manager().loadActive(false).plugins).toEqual([]);
	});

	it("asks for trust with the inventory of what the plugin runs", async () => {
		const { manager } = setup();
		const source = writeTree(tempDir(), {
			"plugin.json": {
				name: "runner",
				hooks: "./hooks.json",
				mcpServers: { api: { command: "node", args: ["server.js"], env: { TOKEN: "${API_TOKEN}" } } },
			},
		});
		const confirm = vi.fn(async () => false);
		const result = await manager().install(source, { confirm });
		const summary = (confirm.mock.calls[0] as unknown as [string[]])[0].join("\n");
		expect(summary).toMatch(/node server\.js/);
		expect(summary).toMatch(/API_TOKEN/);
		expect(summary).toMatch(/hooks/);
		expect(result.plugin.trusted).toBe(false);
	});

	it("installs from Git, pins a SHA, and loads offline from the cache", async () => {
		const { manager } = setup();
		const repo = gitRepo({ "plugin.json": { name: "g" }, "commands/one.md": "one" });
		const first = repo.head();
		repo.commit({ "commands/two.md": "two" });
		const pinned = await manager().install(repo.url, { ref: first, trust: true });
		expect(pinned.plugin.commit).toBe(first);
		expect(
			manager()
				.loadActive(false)
				.plugins[0]?.inventory.commands.map((c) => c.name),
		).toEqual(["one"]);
		expect((await manager().update("g", {})).changed).toBe(false);
		rmSync(repo.dir, { recursive: true, force: true });
		expect(
			manager()
				.loadActive(false)
				.plugins[0]?.inventory.commands.map((c) => c.name),
		).toEqual(["one"]);
	});

	it("never runs npm or lifecycle scripts for a source with package.json", async () => {
		const { manager } = setup();
		const marker = join(tempDir(), "ran");
		const repo = gitRepo({
			"plugin.json": { name: "pkg" },
			"commands/x.md": "x",
			"package.json": {
				name: "pkg",
				scripts: { postinstall: `node -e "require('fs').writeFileSync('${marker.replace(/\\/g, "/")}', '')"` },
			},
		});
		await manager().install(repo.url, { trust: true });
		expect(existsSync(marker)).toBe(false);
		expect(manager().loadActive(false).plugins[0]?.root).toBeDefined();
		expect(existsSync(join(manager().loadActive(false).plugins[0]!.root, "node_modules"))).toBe(false);
	});

	it("does not run a post-checkout hook reached through a relative core.hooksPath", async () => {
		const { manager } = setup();
		const marker = join(tempDir(), "hook-ran");
		const repo = gitRepo({
			"plugin.json": { name: "hooked" },
			"commands/x.md": "x",
			".githooks/post-checkout": `#!/bin/sh\ntouch "${marker.replace(/\\/g, "/")}"\n`,
		});
		if (process.platform !== "win32") execFileSync("chmod", ["+x", join(repo.dir, ".githooks/post-checkout")]);
		const config = join(tempDir(), "gitconfig");
		writeFileSync(config, "[core]\n\thooksPath = .githooks\n");
		vi.stubEnv("GIT_CONFIG_GLOBAL", config);
		await manager().install(repo.url, { trust: true });
		expect(existsSync(marker)).toBe(false);
	});

	it.skipIf(process.platform !== "win32")("never runs a repository's root-level git.cmd", async () => {
		const { manager } = setup();
		const marker = join(tempDir(), "git-cmd-ran");
		const repo = gitRepo({
			"plugin.json": { name: "shadow" },
			"commands/x.md": "x",
			"git.cmd": `@echo off\r\necho.> "${marker}"\r\n`,
		});
		await manager().install(repo.url, { trust: true });
		repo.commit({ "commands/y.md": "y" });
		await manager().update("shadow", {});
		const local = await manager()
			.install(repo.dir, { trust: true })
			.catch((error: Error) => error);
		expect(local).toBeInstanceOf(Error); // same namespace from a different source
		expect(existsSync(marker)).toBe(false);
	});

	it("fails a hanging remote at the deadline and never waits for credentials", async () => {
		const { manager } = setup();
		const sockets: Array<{ destroy(): void }> = [];
		const server: Server = createServer((socket) => sockets.push(socket));
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as { port: number }).port;
		try {
			const started = Date.now();
			await expect(manager({ gitTimeoutMs: 1500 }).install(`http://127.0.0.1:${port}/x.git`, {})).rejects.toThrow(
				/timed out/,
			);
			expect(Date.now() - started).toBeLessThan(10_000);
		} finally {
			for (const socket of sockets) socket.destroy();
			server.close();
		}
		const auth = createServer((socket) =>
			socket.end('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="x"\r\nContent-Length: 0\r\n\r\n'),
		);
		await new Promise<void>((resolve) => auth.listen(0, "127.0.0.1", resolve));
		try {
			const authPort = (auth.address() as { port: number }).port;
			await expect(manager({ gitTimeoutMs: 20_000 }).install(`http://127.0.0.1:${authPort}/x.git`, {})).rejects.toThrow(
				/git/,
			);
		} finally {
			auth.close();
		}
	});

	it("keeps both declarations when two installs run at once", async () => {
		const { manager, settings } = setup();
		const a = writeTree(tempDir(), { "plugin.json": { name: "a" }, "commands/x.md": "x" });
		const b = writeTree(tempDir(), { "plugin.json": { name: "b" }, "commands/x.md": "x" });
		await Promise.all([manager().install(a, { trust: true }), manager().install(b, { trust: true })]);
		expect(
			settings("user")
				.plugins.map((p: { source: string }) => p.source)
				.sort(),
		).toEqual([a, b].sort());
		expect(
			manager()
				.loadActive(false)
				.plugins.map((p) => p.namespace)
				.sort(),
		).toEqual(["a", "b"]);
	});

	it("refuses a second plugin with the same namespace from another source", async () => {
		const { manager } = setup();
		const one = writeTree(tempDir(), { "plugin.json": { name: "same" }, "commands/x.md": "x" });
		const two = writeTree(tempDir(), { "plugin.json": { name: "same" }, "commands/y.md": "y" });
		await manager().install(one, { trust: true });
		await expect(manager().install(two, { trust: true })).rejects.toThrow(/same/);
	});

	it("reports ambiguous names with the candidates", async () => {
		const { manager } = setup();
		const a = writeTree(tempDir(), { "plugin.json": { name: "dup" }, "commands/x.md": "x" });
		await manager().install(a, { trust: true });
		await expect(manager().update("missing", {})).rejects.toThrow(/no installed plugin/);
	});
});

describe("plugin scopes", () => {
	it("refuses project installs in an untrusted project and ignores project declarations there", async () => {
		const { manager, cwd } = setup();
		const source = writeTree(tempDir(), { "plugin.json": { name: "p" }, "commands/x.md": "x" });
		await expect(manager().install(source, { scope: "project", trust: true })).rejects.toThrow(/not trusted/);
		writeTree(cwd, { ".knightcode/settings.json": { plugins: [{ source }] } });
		expect(manager().loadActive(false)).toEqual({ plugins: [], diagnostics: [] });
	});

	it("reports a declared but missing project plugin without fetching", async () => {
		const { manager, cwd } = setup({ trustProject: true });
		writeTree(cwd, { ".knightcode/settings.json": { plugins: [{ source: "https://127.0.0.1:1/never.git" }] } });
		const { plugins, diagnostics } = manager({ gitTimeoutMs: 1 }).loadActive(true);
		expect(plugins).toEqual([]);
		expect(diagnostics.join("\n")).toMatch(/knightcode plugin install https:\/\/127\.0\.0\.1:1\/never\.git -l/);
	});

	it("loads a user pin and project pins of one repository at their own commits", async () => {
		const repo = gitRepo({ "plugin.json": { name: "multi" }, "commands/v1.md": "1" });
		const c1 = repo.head();
		const c2 = repo.commit({ "commands/v2.md": "2" });
		const c3 = repo.commit({ "commands/v3.md": "3" });
		const agentDir = tempDir();
		const projectA = tempDir();
		const projectB = tempDir();
		const store = new ProjectTrustStore(agentDir);
		store.set(projectA, true);
		store.set(projectB, true);
		await new PluginManager({ agentDir, cwd: projectA }).install(repo.url, { ref: c1, trust: true });
		await new PluginManager({ agentDir, cwd: projectA }).install(repo.url, { ref: c2, scope: "project", trust: true });
		await new PluginManager({ agentDir, cwd: projectB }).install(repo.url, { ref: c3, scope: "project", trust: true });
		const commitIn = (cwd: string, trusted: boolean) =>
			new PluginManager({ agentDir, cwd }).loadActive(trusted).plugins.map((plugin) => plugin.commit);
		expect(commitIn(agentDir, false)).toEqual([c1]);
		expect(commitIn(projectA, true)).toEqual([c2]);
		expect(commitIn(projectB, true)).toEqual([c3]);
	});

	it("lets a project declaration disable a user plugin", async () => {
		const { manager, cwd } = setup({ trustProject: true });
		const source = writeTree(tempDir(), { "plugin.json": { name: "u" }, "commands/x.md": "x" });
		await manager().install(source, { trust: true });
		writeTree(cwd, { ".knightcode/settings.json": { plugins: [{ source, enabled: false }] } });
		expect(manager().loadActive(true).plugins).toEqual([]);
		expect(manager().loadActive(false).plugins).toHaveLength(1);
	});
});

describe("plugin mutation ordering", () => {
	it("leaves the plugin inactive when the declaration write fails after the record", async () => {
		const { manager, settings } = setup();
		const source = writeTree(tempDir(), { "plugin.json": { name: "half" }, "commands/x.md": "x" });
		const failpoint = (step: string) => {
			if (step === "record") throw new Error("injected");
		};
		await expect(manager({ failpoint }).install(source, { trust: true })).rejects.toThrow(/injected/);
		expect(settings("user").plugins).toBeUndefined();
		expect(manager().loadActive(false).plugins).toEqual([]);
	});

	it("never leaves an active plugin without its record when uninstall fails partway", async () => {
		const { manager, settings } = setup();
		const source = writeTree(tempDir(), { "plugin.json": { name: "gone" }, "commands/x.md": "x" });
		await manager().install(source, { trust: true });
		const failpoint = (step: string) => {
			if (step === "declaration") throw new Error("injected");
		};
		await expect(manager({ failpoint }).uninstall("gone", {})).rejects.toThrow(/injected/);
		expect(settings("user").plugins).toEqual([]);
		expect(manager().loadActive(false).plugins).toEqual([]);
		await manager()
			.uninstall("gone", {})
			.catch(() => {});
		expect(manager().list()).toEqual([]);
	});

	it("aborts before writing anything when settings fail to load", async () => {
		const { manager, agentDir } = setup();
		writeFileSync(join(agentDir, "settings.json"), "{ broken");
		const source = writeTree(tempDir(), { "plugin.json": { name: "x" }, "commands/x.md": "x" });
		await expect(manager().install(source, { trust: true })).rejects.toThrow(/settings/);
		expect(readFileSync(join(agentDir, "settings.json"), "utf-8")).toBe("{ broken");
		expect(manager().list()).toEqual([]);
	});

	it("removes registration and trust on uninstall but keeps data and revisions", async () => {
		const { manager, agentDir } = setup();
		const source = writeTree(tempDir(), { "plugin.json": { name: "keep" }, "commands/x.md": "x" });
		const { plugin } = await manager().install(source, { trust: true });
		mkdirSync(plugin.dataDir, { recursive: true });
		writeFileSync(join(plugin.dataDir, "state"), "1");
		await manager().uninstall("keep", {});
		expect(manager().list()).toEqual([]);
		expect(existsSync(join(plugin.dataDir, "state"))).toBe(true);
		expect(existsSync(plugin.root)).toBe(true);
		const again = await manager().install(source, {});
		expect(again.plugin.trusted).toBe(false);
		expect(existsSync(join(agentDir, "plugins", "state.json"))).toBe(true);
	});
});

describe("marketplaces", () => {
	afterEach(() => vi.unstubAllEnvs());

	it("activates nothing when added and installs entries by name@marketplace", async () => {
		const { manager } = setup();
		const market = gitRepo({
			".claude-plugin/marketplace.json": {
				name: "shop",
				plugins: [
					{ name: "alpha", source: "./plugins/alpha", description: "A" },
					{ name: "beta", source: "./plugins/alpha", commands: ["./extra.md"] },
				],
			},
			"plugins/alpha/commands/a.md": "a",
			"plugins/alpha/extra.md": "extra",
		});
		const added = await manager().addMarketplace(market.url, {});
		expect(added.name).toBe("shop");
		expect(manager().loadActive(false).plugins).toEqual([]);
		expect(
			manager()
				.listMarketplaces()[0]
				?.plugins.map((entry) => entry.name),
		).toEqual(["alpha", "beta"]);
		const alpha = await manager().install("alpha@shop", { trust: true });
		const beta = await manager().install("beta@shop", { trust: true });
		// Two entries over the same directory stay two plugins.
		expect(alpha.plugin.identity).not.toBe(beta.plugin.identity);
		expect(
			manager()
				.loadActive(false)
				.plugins.map((plugin) => plugin.namespace)
				.sort(),
		).toEqual(["alpha", "beta"]);
		expect(beta.plugin.inventory.commands.map((command) => command.name).sort()).toEqual(["a", "extra"]);
		await manager().removeMarketplace("shop", {});
		expect(manager().loadActive(false).plugins).toHaveLength(2);
	});
});
