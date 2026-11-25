/**
 * S9 packaged smoke: install the packaged Windows build outside the dev tree (a copy under the scratch root), launch
 * it with a scratch profile and no Node/Bun on PATH, and check that a frontend+backend extension loads and its
 * backend runs, that safe mode runs neither, and that the built-ins render. Driven over CDP, not the dev harness.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium, expect, test, type Browser, type Page } from "@playwright/test";
import { createDesktopFixture } from "../fixtures/desktop.ts";

const distribution = resolve(__dirname, "../../out/KnightCode-win32-x64");
const approve = resolve(__dirname, "../../../../packages/cli/test/fixtures/desktop-approve.ts");
const examples = resolve(__dirname, "../../../../packages/cli/examples/desktop-extensions");
const exec = promisify(execFile);

test("packaged install: external frontend and backend run, safe mode runs neither, built-ins render", async ({}, info) => {
	test.skip(process.platform !== "win32", "This smoke covers the native Windows packaged layout.");
	test.setTimeout(240_000);
	const f = createDesktopFixture({ theme: "light", nativeExtensions: true });
	const installed = join(f.root, "installed");
	const source = join(f.agentDir, "desktop-extensions", "02-backend");
	const started = join(f.root, "backend-started");
	cpSync(join(examples, "02-backend"), source, { recursive: true });
	const server = join(source, "server.ts");
	writeFileSync(
		server,
		readFileSync(server, "utf8")
			.replace(
				'import { Type } from "typebox";',
				'import { Type } from "typebox";\nimport { appendFileSync } from "node:fs";',
			)
			.replace(
				"app.experimental_onActivate((context) => {",
				`app.experimental_onActivate((context) => {\n\t\tappendFileSync(${JSON.stringify(started)}, "start\\n");`,
			),
	);
	if (!existsSync(distribution)) throw new Error("Run stage-server.ts and package before the packaged smoke.");
	try {
		cpSync(distribution, installed, { recursive: true });
		// Harness consent stands in for the native dialog; it is not a product approval endpoint.
		await exec("bun", [approve, f.agentDir, source]);
		const system32 = join(process.env.SystemRoot ?? "C:\\Windows", "System32");
		const env: Record<string, string> = { ...f.env, PATH: system32 };
		delete env.Path;
		for (const runtime of ["node", "bun"])
			expect(await exec(join(system32, "where.exe"), [runtime], { env }).catch(() => undefined)).toBeUndefined();
		const record: string[] = [];
		const launch = async (safeMode: boolean, run: (page: Page) => Promise<void>) => {
			const profile = join(f.root, safeMode ? "profile-safe" : "profile");
			cpSync(f.userData, profile, { recursive: true });
			let child: ChildProcess | undefined;
			let browser: Browser | undefined;
			const logs: string[] = [];
			try {
				child = spawn(
					join(installed, "knightcode-desktop.exe"),
					[
						`--user-data-dir=${profile}`,
						"--remote-debugging-port=0",
						`knightcode://new?cwd=${encodeURIComponent(f.project)}`,
						...(safeMode ? ["--safe-mode"] : []),
					],
					{ cwd: f.project, env, stdio: ["ignore", "pipe", "pipe"] },
				);
				child.stdout?.on("data", (data) => logs.push(String(data)));
				child.stderr?.on("data", (data) => logs.push(String(data)));
				const portFile = join(profile, "DevToolsActivePort");
				await expect.poll(() => existsSync(portFile), { timeout: 60_000 }).toBe(true);
				browser = await chromium.connectOverCDP(`http://127.0.0.1:${readFileSync(portFile, "utf8").split(/\r?\n/)[0]}`);
				const context = browser.contexts()[0]!;
				const page = context.pages()[0] ?? (await context.waitForEvent("page"));
				page.on("pageerror", (error) => logs.push(`[pageerror] ${error.stack}`));
				await run(page);
			} finally {
				const output = info.outputPath(`packaged-smoke-${safeMode ? "safe" : "normal"}.log`);
				writeFileSync(output, logs.join(""));
				await info.attach(`packaged-smoke-${safeMode ? "safe" : "normal"}`, {
					path: output,
					contentType: "text/plain",
				});
				const log = join(profile, "logs", "app-server.log");
				if (existsSync(log))
					await info.attach(`app-server-${safeMode ? "safe" : "normal"}.log`, { path: log, contentType: "text/plain" });
				await browser?.close();
				if (child?.pid && child.exitCode === null)
					await exec(join(system32, "taskkill.exe"), ["/PID", String(child.pid), "/T", "/F"]).catch(() => {});
			}
		};
		const builtins = async (page: Page) => {
			// The installed app runs its own bundled server with no provider signed in.
			await expect(page.getByRole("heading", { level: 1, name: /What should we build/ })).toBeVisible({
				timeout: 60_000,
			});
			await expect(page.getByRole("navigation", { name: "App navigation" })).toBeVisible();
			await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeVisible();
			for (const owner of [
				"builtin.layout",
				"builtin.navigation",
				"builtin.thread-list",
				"builtin.home",
				"builtin.composer",
				"builtin.title-bar",
			])
				await expect(page.locator(`[data-kc-owner="${owner}"]`).first()).toBeAttached();
		};
		await launch(false, async (page) => {
			await builtins(page);
			record.push("normal: built-ins rendered");
			await page.getByRole("button", { name: "Backend counter", exact: true }).click();
			const counter = page.getByRole("region", { name: "Backend counter" });
			await expect(counter.getByLabel("Shared count")).not.toHaveText("Connecting…", { timeout: 30_000 });
			await counter.getByRole("button", { name: "Increment shared counter", exact: true }).click();
			await expect(counter.getByLabel("Shared count")).toHaveText("1");
			await expect.poll(() => (existsSync(started) ? readFileSync(started, "utf8") : "")).toBe("start\n");
			record.push("normal: external page loaded, backend started once, RPC write returned 1");
		});
		await launch(true, async (page) => {
			await builtins(page);
			record.push("safe: built-ins rendered");
			await expect(page.getByRole("button", { name: "Backend counter", exact: true })).toHaveCount(0);
			await expect(page.locator('script[src^="app://ext/"], link[data-kc-styles]')).toHaveCount(0);
			await page.waitForTimeout(2_000);
			expect(readFileSync(started, "utf8")).toBe("start\n");
			record.push("safe: no external script or stylesheet, backend not started");
		});
		await info.attach("packaged-smoke-record", { body: record.join("\n"), contentType: "text/plain" });
		console.log(`Packaged smoke from ${installed}:\n${record.join("\n")}`);
	} finally {
		rmSync(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});
