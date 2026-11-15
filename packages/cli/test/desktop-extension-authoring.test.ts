import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startDesktopControl } from "../src/app-server/desktop-extensions/control.ts";
import { DesktopExtensionManager } from "../src/app-server/desktop-extensions/manager.ts";
import { runDesktopExtCommand } from "../src/cli/desktop-ext.ts";

const roots: string[] = [];
const cleanups: (() => void)[] = [];
function fixture() {
	const agentDir = mkdtempSync(join(tmpdir(), "kc-desktop-author-"));
	roots.push(agentDir);
	const lines: string[] = [];
	const run = async (args: string[], env: NodeJS.ProcessEnv = {}) => {
		const { stdout } = await promisify(execFile)(
			"bun",
			[fileURLToPath(new URL("./fixtures/desktop-author.ts", import.meta.url)), agentDir, ...args],
			{ encoding: "utf8", env: { ...process.env, ...env } },
		);
		const result = JSON.parse(stdout) as { code: number; lines: string[] };
		lines.push(...result.lines);
		return result.code;
	};
	return { agentDir, lines, run };
}
afterEach(() => {
	for (const close of cleanups.splice(0)) close();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("desktop extension authoring", () => {
	it("creates and validates without executing source or granting native consent", async () => {
		const { agentDir, lines, run } = fixture();
		expect(await run(["new", "notice", "--json"])).toBe(0);
		const source = join(agentDir, "desktop-extensions", "notice");
		expect(JSON.parse(lines.pop()!).source).toBe(source);
		expect(readFileSync(join(source, "app.tsx"), "utf8")).toContain("defineDesktopExtension");
		expect(await run(["validate", source, "--json"])).toBe(0);
		expect(JSON.parse(lines.pop()!).valid).toBe(true);
		expect(existsSync(join(agentDir, "desktop-extension-consent.json"))).toBe(false);
		writeFileSync(join(source, "app.tsx"), 'throw new Error("must not execute"); export default {};');
		expect(await run(["validate", source])).toBe(0);
		expect(await run(["new", "notice"])).toBe(1);
		expect(readFileSync(join(source, "app.tsx"), "utf8")).toContain("must not execute");
	});
	it("Node clients validate prebuilt ESM and report the bundled-compiler requirement for TSX", async () => {
		const { agentDir, lines } = fixture();
		const options = { agentDir, cwd: agentDir, output: (line: string) => lines.push(line) };
		expect(await runDesktopExtCommand(["new", "prebuilt"], options)).toBe(0);
		const source = join(agentDir, "desktop-extensions", "prebuilt");
		expect(await runDesktopExtCommand(["validate", source, "--json"], options)).toBe(1);
		expect(JSON.parse(lines.pop()!).error).toContain("bundled Bun compiler");
		writeFileSync(join(source, "package.json"), JSON.stringify({ knightcode: { desktop: { frontend: "./app.js" } } }));
		writeFileSync(join(source, "app.js"), "export default {};\n");
		expect(await runDesktopExtCommand(["validate", source, "--json"], options)).toBe(0);
		expect(JSON.parse(lines.pop()!).valid).toBe(true);
		cleanups.push(await startDesktopControl(agentDir, new DesktopExtensionManager(agentDir), () => {}));
		expect(await runDesktopExtCommand(["status", "--json"], options)).toBe(0);
		expect(JSON.parse(lines.pop()!).servers).toHaveLength(1);
	});
	it.each(["../escape", "a/b", "..", "", "UPPER", "a\\b"])("rejects unsafe package name %j", async (name) => {
		const { run } = fixture();
		expect(await run(["new", name, "--json"])).toBe(1);
	});
	it("returns structured validation errors and rejects retired SDK member aliases", async () => {
		const { agentDir, lines, run } = fixture();
		await run(["new", "notice"]);
		const source = join(agentDir, "desktop-extensions", "notice");
		writeFileSync(
			join(source, "app.tsx"),
			'import { experimental_notify as notify } from "@knightcodeai/cli/desktop"; export default {};',
		);
		expect(await run(["validate", source, "--json"])).toBe(1);
		expect(JSON.parse(lines.pop()!).error).toMatch(/retired.*experimental_notify.*experimental_controllers/s);
		writeFileSync(join(source, "app.tsx"), "export default {};");
		writeFileSync(join(source, "app.css"), "body { color:red }");
		expect(await run(["validate", source, "--json"])).toBe(1);
		expect(JSON.parse(lines.pop()!).error).toMatch(/body.*:scope.*desktop-extensions §Styles/);
	});
	it("reads live diagnostics and reloads every running desktop server", async () => {
		const { agentDir, lines, run } = fixture();
		await run(["new", "notice"]);
		const managers = [new DesktopExtensionManager(agentDir), new DesktopExtensionManager(agentDir)];
		let reloads = 0;
		for (const manager of managers) {
			const entry = (await manager.list()).extensions[0]!;
			manager.report(entry.owner, { windowId: 7, revision: "r1", phase: "load", message: "Broken setup" });
			cleanups.push(
				await startDesktopControl(agentDir, manager, () => {
					reloads++;
				}),
			);
		}
		expect(await run(["status", "--json"])).toBe(0);
		const status = JSON.parse(lines.pop()!);
		expect(status.servers).toHaveLength(2);
		expect(status.servers[0].extensions[0].diagnostics[0].message).toBe("Broken setup");
		expect(await run(["reload", "--json"])).toBe(0);
		expect(reloads).toBe(2);
	});
	it("does not expose controls to unauthenticated HTTP or browser origins, and cleans discovery on close", async () => {
		const { agentDir, lines, run } = fixture();
		const close = await startDesktopControl(agentDir, new DesktopExtensionManager(agentDir), () => {});
		cleanups.push(close);
		const directory = join(agentDir, "desktop-control");
		const endpoint = JSON.parse(readFileSync(join(directory, readdirSync(directory)[0]!), "utf8"));
		const url = `http://127.0.0.1:${endpoint.port}/status`;
		await expect(fetch(url)).rejects.toThrow();
		await expect(fetch(url, { headers: { origin: "https://evil.example" } })).rejects.toThrow();
		writeFileSync(join(directory, readdirSync(directory)[0]!), JSON.stringify({ ...endpoint, token: "0".repeat(64) }));
		expect(await run(["status", "--json"])).toBe(1);
		expect(JSON.parse(lines.pop()!).error).toContain("Unauthorized");
		close();
		expect(readdirSync(directory)).toEqual([]);
	});
	it("never sends a loopback control token through an HTTP proxy", async () => {
		const { agentDir, lines, run } = fixture();
		cleanups.push(await startDesktopControl(agentDir, new DesktopExtensionManager(agentDir), () => {}));
		const code = await run(["status", "--json"], {
			HTTP_PROXY: "http://127.0.0.1:9",
			http_proxy: "http://127.0.0.1:9",
			NO_PROXY: "",
			no_proxy: "",
		});
		expect(code, lines.join("\n")).toBe(0);
	});
	it("keeps safe-mode state accurate in reload responses", async () => {
		const { agentDir, lines, run } = fixture();
		cleanups.push(
			await startDesktopControl(agentDir, new DesktopExtensionManager(agentDir, { safeMode: true }), () => {}),
		);
		expect(await run(["reload", "--json"])).toBe(0);
		expect(JSON.parse(lines.pop()!).servers[0].safeMode).toBe(true);
	});
	it("reports stale peers even when another desktop accepted a reload", async () => {
		const { agentDir, lines, run } = fixture();
		cleanups.push(await startDesktopControl(agentDir, new DesktopExtensionManager(agentDir), () => {}));
		writeFileSync(
			join(agentDir, "desktop-control", "stale.json"),
			JSON.stringify({ port: 9, token: "0".repeat(64), pid: 1 }),
		);
		expect(await run(["reload"])).toBe(1);
		expect(lines.pop()).toContain("stale.json");
	});
	it("checks namespace SDK aliases before activation", async () => {
		const { agentDir, lines, run } = fixture();
		await run(["new", "notice"]);
		const source = join(agentDir, "desktop-extensions", "notice");
		writeFileSync(
			join(source, "app.tsx"),
			'import * as sdk from "@knightcodeai/cli/desktop"; sdk.experimental_notify("bad"); export default {};',
		);
		expect(await run(["validate", source, "--json"])).toBe(1);
		expect(JSON.parse(lines.pop()!).error).toContain("experimental_controllers");
	});
	it("reports an offline desktop instead of presenting a new server's empty diagnostics", async () => {
		const { lines, run } = fixture();
		expect(await run(["status", "--json"])).toBe(1);
		expect(JSON.parse(lines.pop()!).error).toMatch(/running desktop/i);
		expect(await run(["reload", "unexpected"])).toBe(1);
	});
});
