import { describe, expect, it } from "vitest";
import { runPluginCommand } from "../../src/plugins/cli.ts";
import { useTempDirs, writeTree } from "./helpers.ts";

const tempDir = useTempDirs();

function setup() {
	const agentDir = tempDir();
	const cwd = tempDir();
	const out: string[] = [];
	const err: string[] = [];
	const run = (...args: string[]) =>
		runPluginCommand(args, {
			cwd,
			agentDir,
			log: (line) => out.push(line),
			error: (line) => err.push(line),
			isInteractive: false,
		});
	const take = () => {
		const result = { out: out.join("\n"), err: err.join("\n") };
		out.length = 0;
		err.length = 0;
		return result;
	};
	return { run, take, cwd, agentDir };
}

const plugin = () =>
	writeTree(tempDir(), {
		"plugin.json": { name: "demo", description: "Demo plugin", hooks: "./hooks.json" },
		"commands/go.md": "Go",
		"skills/fix/SKILL.md": "---\ndescription: Fix\n---\n",
	});

describe("knightcode plugin", () => {
	it("prints help and rejects unknown commands", async () => {
		const { run, take } = setup();
		expect(await run("--help")).toBe(0);
		expect(take().out).toMatch(/plugin install <source\|name@marketplace>/);
		expect(await run("frobnicate")).toBe(1);
		expect(take().err).toMatch(/Unknown plugin command "frobnicate"/);
		expect(await run("install")).toBe(1);
		expect(take().err).toMatch(/install needs a source/);
		expect(await run("install", "x", "--bogus")).toBe(1);
		expect(take().err).toMatch(/Unknown option --bogus/);
	});

	it("installs inactive without --trust when it cannot ask, and activates with enable --trust", async () => {
		const { run, take } = setup();
		const source = plugin();
		expect(await run("install", source)).toBe(0);
		const installed = take().out;
		expect(installed).toMatch(/Commands: \/demo:go/);
		expect(installed).toMatch(/Not supported, never run: hooks/);
		expect(installed).toMatch(/not trusted.*knightcode plugin enable demo --trust/s);
		expect(await run("list", "--json")).toBe(0);
		expect(JSON.parse(take().out)).toMatchObject([
			{ name: "demo", scope: "user", enabled: true, trusted: false, active: false },
		]);
		expect(await run("enable", "demo", "--trust")).toBe(0);
		take();
		expect(await run("list", "--json")).toBe(0);
		expect(JSON.parse(take().out)).toMatchObject([{ name: "demo", trusted: true, active: true }]);
	});

	it("shows details, disables, updates and uninstalls", async () => {
		const { run, take } = setup();
		const source = plugin();
		expect(await run("install", source, "--trust")).toBe(0);
		take();
		expect(await run("details", "demo")).toBe(0);
		expect(take().out).toMatch(/Skills: demo:fix/);
		expect(await run("disable", "demo")).toBe(0);
		take();
		expect(await run("list")).toBe(0);
		expect(take().out).toMatch(/demo.*disabled/);
		expect(await run("update", "demo")).toBe(0);
		expect(take().out).toMatch(/already up to date/);
		expect(await run("uninstall", "demo")).toBe(0);
		take();
		expect(await run("details", "demo")).toBe(1);
		expect(take().err).toMatch(/no installed plugin "demo"/);
	});

	it("refuses project scope in an untrusted project", async () => {
		const { run, take } = setup();
		expect(await run("install", plugin(), "-l", "--trust")).toBe(1);
		expect(take().err).toMatch(/not trusted/);
	});

	it("validates a plugin directory without installing it", async () => {
		const { run, take } = setup();
		expect(await run("validate", plugin())).toBe(0);
		expect(take().out).toMatch(/Commands: \/demo:go/);
		expect(await run("list", "--json")).toBe(0);
		expect(JSON.parse(take().out)).toEqual([]);
		expect(await run("validate", tempDir())).toBe(1);
		expect(take().err).toMatch(/not a plugin/);
	});

	it("adds, lists and removes marketplaces", async () => {
		const { run, take } = setup();
		const market = writeTree(tempDir(), {
			".claude-plugin/marketplace.json": { name: "shop", plugins: [{ name: "alpha", source: "./alpha" }] },
			"alpha/commands/a.md": "a",
		});
		expect(await run("marketplace", "add", market)).toBe(0);
		expect(take().out).toMatch(/Added marketplace shop.*alpha/s);
		expect(await run("marketplace", "list", "--json")).toBe(0);
		expect(JSON.parse(take().out)).toMatchObject([{ name: "shop", plugins: [{ name: "alpha", installed: false }] }]);
		expect(await run("list", "--json")).toBe(0);
		expect(JSON.parse(take().out)).toEqual([]);
		expect(await run("install", "alpha@shop", "--trust")).toBe(0);
		take();
		expect(await run("marketplace", "remove", "shop")).toBe(0);
		take();
		expect(await run("list", "--json")).toBe(0);
		expect(JSON.parse(take().out)).toMatchObject([{ name: "alpha", marketplace: "shop", active: true }]);
	});
});
