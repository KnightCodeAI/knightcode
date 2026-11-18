/** Packaged Windows acceptance: real immutable ESM/jiti, native ports and two renderer processes, no paid providers. */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium, expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { createDesktopFixture } from "../fixtures/desktop.ts";

type Outcome = { status: string; value?: unknown };
type Handles = {
	echo(): Promise<Outcome>;
	read(): Promise<Outcome>;
	slowRead(ms: number): Promise<Outcome>;
	slowWrite(ms: number): Promise<Outcome>;
	cancelWrite(ms: number): Promise<Outcome>;
	settings(): Promise<Outcome>;
	setSetting(id: string, value: unknown): Promise<Outcome>;
};
declare global {
	interface Window {
		__backendProofPort?: MessagePort;
		__backendProofHandles?: Handles[];
		__backendProofOutcomes?: Outcome[];
	}
}
const distribution = resolve(__dirname, "../../out/KnightCode-win32-x64");
const approve = resolve(__dirname, "../../../../packages/cli/test/fixtures/desktop-approve.ts");
const exec = promisify(execFile);

type RevisionOptions = {
	failPreparation?: boolean;
	failWindow?: number;
	blockWindow?: number;
	failBackend?: boolean;
	failStart?: boolean;
	failStop?: boolean;
};

type Running = {
	page: Page;
	second(): Promise<Page>;
	version(version: 1 | 2, options?: RevisionOptions): void;
	restart(): Promise<void>;
	status(): Promise<string>;
	thread(): Promise<void>;
	starts: string;
	started: string;
	completed: string;
	pid: string;
};

async function packaged(info: TestInfo, run: (app: Running) => Promise<void>, safeMode = false): Promise<void> {
	test.skip(process.platform !== "win32", "This proof requires the native Windows packaged layout.");
	const f = createDesktopFixture({ theme: "light" });
	const installed = join(f.root, "installed");
	const source = join(f.agentDir, "desktop-extensions", "backend-proof");
	const starts = join(f.root, "services.log");
	const started = join(f.root, "write-started");
	const completed = join(f.root, "write-completed");
	const pid = join(f.root, "backend.pid");
	mkdirSync(source, { recursive: true });
	writeFileSync(
		join(source, "package.json"),
		JSON.stringify({
			knightcode: { desktop: { frontend: "./app.tsx", backend: "./server.ts", styles: ["./app.css"] } },
		}),
	);
	const version = (value: 1 | 2, options?: RevisionOptions) => {
		writeFileSync(
			join(source, "contract.ts"),
			`import { Type } from "typebox";
export const version = ${value};
export const failPreparation = ${options?.failPreparation ?? false};
export const failWindow = ${options?.failWindow ?? -1};
export const blockWindow = ${options?.blockWindow ?? -1};
export const failBackend = ${options?.failBackend ?? false};
export const failStart = ${options?.failStart ?? false};
export const failStop = ${options?.failStop ?? false};
export const echo = { id: "echo", params: Type.${value === 1 ? "Number" : "String"}(), result: Type.${value === 1 ? "Number" : "String"}() };
export const read = { id: "read", params: Type.Null(), result: Type.Number() };
export const slowRead = { id: "slowRead", params: Type.Number(), result: Type.Number() };
export const slowWrite = { id: "slowWrite", params: Type.Number(), result: Type.Number() };
export const tick = { id: "tick", schema: Type.Number() };`,
		);
	};
	version(1);
	writeFileSync(
		join(source, "app.css"),
		'.backend-proof {color:rgb(17,83,149)} .backend-proof[data-version="2"] {color:rgb(34,113,72)}',
	);
	writeFileSync(
		join(source, "server.ts"),
		`import { experimental_defineDesktopBackend } from "@knightcodeai/cli/desktop-backend";
import { appendFileSync, writeFileSync } from "node:fs";
import { Type } from "typebox";
import { version, failBackend, failStart, failStop, echo, read, slowRead, slowWrite, tick } from "./contract.ts";
export default experimental_defineDesktopBackend(app => {
 if (failBackend) throw new Error("Packaged backend preparation rejected");
 const count = app.experimental_storage({ id: "count", schema: Type.Number() });
 const event = app.experimental_event(tick);
 app.experimental_setting({ id: "label", schema: Type.String(), default: "Public label" });
 app.experimental_setting({ id: "token", schema: Type.String(), default: "packaged-secret-never-project", secret: true });
 app.experimental_registerRpc({ ...echo, kind: "read", experimental_handle: value => value });
 app.experimental_registerRpc({ ...read, kind: "read", experimental_handle: () => count.experimental_get() ?? 0 });
 app.experimental_registerRpc({ ...slowRead, kind: "read", experimental_handle: async ms => { await new Promise(resolve => setTimeout(resolve, ms)); return count.experimental_get() ?? 0; } });
 app.experimental_registerRpc({ ...slowWrite, kind: "write", experimental_handle: async ms => {
  writeFileSync(${JSON.stringify(started)}, "started"); await new Promise(resolve => setTimeout(resolve, ms));
  const next = (count.experimental_get() ?? 0) + 1; count.experimental_set(next); event.experimental_emit(next);
  writeFileSync(${JSON.stringify(completed)}, String(next)); return next;
 } });
 app.experimental_onActivate(context => {
  if (failStart) throw new Error("Packaged backend start failed");
  appendFileSync(${JSON.stringify(starts)}, "start:" + version + "\\n"); writeFileSync(${JSON.stringify(pid)}, String(process.pid));
  let timer; const stop = () => { clearInterval(timer); timer = undefined; };
  const start = () => { timer = setInterval(() => event.experimental_emit(count.experimental_get() ?? 0), 100); };
  start(); context.experimental_onPause(stop); context.experimental_onResume(start);
  return () => { stop(); appendFileSync(${JSON.stringify(starts)}, "stop:" + version + "\\n"); if (failStop) throw new Error("Packaged old teardown failed"); };
 });
});`,
	);
	writeFileSync(
		join(source, "app.tsx"),
		`import { useEffect, useState } from "react";
import { defineDesktopExtension, experimental_useBackend } from "@knightcodeai/cli/desktop";
import { version, failPreparation, failWindow, blockWindow, echo, read, slowRead, slowWrite, tick } from "./contract.ts";
if (window.knightcode.windowId === blockWindow) await new Promise(() => {});
function Counter() {
 const backend = experimental_useBackend(); const [count, setCount] = useState(-1); const [result, setResult] = useState("");
 if (window.knightcode.windowId === failWindow) throw new Error("Packaged post-commit mount failed");
 useEffect(() => {
  if (!backend) return;
  const lifetime = new AbortController();
  const handles = {
   echo: () => backend.experimental_call(echo, version === 1 ? 7 : "v2"),
   read: () => backend.experimental_call(read, null),
   slowRead: ms => backend.experimental_call(slowRead, ms),
   slowWrite: ms => backend.experimental_call(slowWrite, ms),
   cancelWrite: ms => { const controller = new AbortController(); const result = backend.experimental_call(slowWrite, ms, controller.signal); setTimeout(() => controller.abort(), 100); return result; },
   settings: () => backend.experimental_settings(),
   setSetting: (id, value) => backend.experimental_setSetting(id, value)
  };
  (window.__backendProofHandles ??= []).push(handles);
  void handles.read().then(value => { if (!lifetime.signal.aborted && value.status === "ok") setCount(value.value); });
  const subscription = backend.experimental_subscribe(tick, setCount, lifetime.signal);
  return () => { lifetime.abort(); subscription.dispose(); };
 }, [backend]);
 return <section className="backend-proof" data-version={version} aria-label="Packaged backend">
  <span>Backend revision {version}</span><output aria-label="Backend count">{count}</output>
  <button disabled={!backend} onClick={() => void backend.experimental_call(echo, version === 1 ? 7 : "v2").then(value => setResult(value.status === "ok" ? String(value.value) : value.status + (value.message ? ": " + value.message : "")))}>Echo backend</button>
  <output aria-label="Backend echo">{result}</output>
 </section>;
}
export default defineDesktopExtension(app => {
 if (failPreparation) throw new Error("Packaged preparation rejected");
 app.experimental_registerSlot({ id: "counter", surface: "feedback", experimental_render: Counter });
 app.experimental_registerPage({ id: "page", label: "Backend proof page", experimental_render: Counter });
 app.experimental_registerPanelTab({ id: "panel", label: "Live backend proof", experimental_available: context => !context.sidebarOpen, experimental_render: Counter });
});`,
	);
	// A synthetic endpoint is configured but no inference is requested by these backend-only tests.
	writeFileSync(
		join(f.agentDir, "models.json"),
		JSON.stringify({
			providers: {
				"backend-proof": {
					api: "openai-completions",
					baseUrl: "http://127.0.0.1:9/v1",
					apiKey: "local-fixture-only",
					models: [
						{
							id: "backend-proof",
							name: "Backend proof",
							reasoning: false,
							input: ["text"],
							contextWindow: 128000,
							maxTokens: 4096,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						},
					],
				},
			},
		}),
	);
	writeFileSync(
		join(f.agentDir, "settings.json"),
		JSON.stringify({ defaultProvider: "backend-proof", defaultModel: "backend-proof", cacheWarming: "off" }),
	);
	let browser: Browser | undefined;
	let child: ChildProcess | undefined;
	const logs: string[] = [];
	const system32 = join(process.env.SystemRoot ?? "C:\\Windows", "System32");
	try {
		if (!existsSync(distribution)) throw new Error("Run stage-server.ts and package before packaged acceptance.");
		cpSync(distribution, installed, { recursive: true });
		// Harness consent is not a product approval endpoint. The app itself has neither Node nor Bun on PATH.
		await exec("bun", [approve, f.agentDir, source]);
		const env: Record<string, string> = {
			...f.env,
			PATH: [system32, join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "cmd")].join(delimiter),
		};
		delete env.Path;
		for (const runtime of ["node", "bun"])
			expect(await exec(join(system32, "where.exe"), [runtime], { env }).catch(() => undefined)).toBeUndefined();
		child = spawn(
			join(installed, "knightcode-desktop.exe"),
			[
				`--user-data-dir=${f.userData}`,
				"--remote-debugging-port=0",
				`knightcode://new?cwd=${encodeURIComponent(f.project)}`,
				...(safeMode ? ["--safe-mode"] : []),
			],
			{ cwd: f.project, env, stdio: ["ignore", "pipe", "pipe"] },
		);
		child.stdout?.on("data", (data) => logs.push(String(data)));
		child.stderr?.on("data", (data) => logs.push(String(data)));
		const portFile = join(f.userData, "DevToolsActivePort");
		await expect.poll(() => existsSync(portFile)).toBe(true);
		browser = await chromium.connectOverCDP(`http://127.0.0.1:${readFileSync(portFile, "utf8").split(/\r?\n/)[0]}`);
		const context = browser.contexts()[0]!;
		await context.addInitScript(() =>
			window.addEventListener("message", (event) => {
				if (event.source === window && event.data === "kc:port" && event.ports[0]) {
					window.__backendProofPort = event.ports[0];
					event.ports[0].addEventListener("message", (packet) => {
						if (packet.data?.event === "desktopExtension/phase" || packet.data?.event === "server/state")
							console.log("backend-proof-phase", JSON.stringify(packet.data));
					});
				}
			}),
		);
		context.on("page", (page) => page.on("pageerror", (error) => logs.push(`[pageerror] ${error.stack}`)));
		const page = context.pages()[0] ?? (await context.waitForEvent("page"));
		page.on("console", (message) => logs.push(`[first ${message.type()}] ${message.text()}`));
		page.on("pageerror", (error) => logs.push(`[first pageerror] ${error.stack}`));
		await page.reload();
		const host = async (target: Page, method: string) => {
			await expect.poll(() => target.evaluate(() => !!window.__backendProofPort)).toBe(true);
			await target.evaluate(
				(method) => window.__backendProofPort!.postMessage({ id: 900000, host: method, params: {} }),
				method,
			);
		};
		if (!safeMode) {
			await expect(page.getByText("Backend revision 1", { exact: true })).toBeVisible();
			await expect.poll(() => page.evaluate(() => window.__backendProofHandles?.length ?? 0)).toBeGreaterThan(0);
		} else await expect(page.getByText("Backend proof", { exact: true }).first()).toBeVisible();
		await run({
			page,
			version,
			starts,
			started,
			completed,
			pid,
			second: async () => {
				const pending = context.waitForEvent("page");
				await host(page, "host/window/open");
				const second = await pending;
				await expect(second.getByText("Backend revision 1", { exact: true })).toBeVisible();
				await expect.poll(() => second.evaluate(() => window.__backendProofHandles?.length ?? 0)).toBeGreaterThan(0);
				return second;
			},
			restart: async () => {
				await exec(join(system32, "taskkill.exe"), ["/PID", readFileSync(pid, "utf8"), "/T", "/F"]);
			},
			thread: async () => {
				const id = await page.evaluate(
					(cwd) =>
						new Promise<string>((resolve, reject) => {
							const port = window.__backendProofPort!;
							const receive = (event: MessageEvent) => {
								if (event.data.id !== 900001) return;
								port.removeEventListener("message", receive);
								if (event.data.error) reject(new Error(event.data.error.message));
								else resolve(event.data.result.thread.id);
							};
							port.addEventListener("message", receive);
							port.postMessage({ id: 900001, method: "thread/start", params: { cwd } });
						}),
					f.project,
				);
				await page.evaluate(async (id) => {
					await globalThis.__knightcodeDesktop!.experimental_controllers.experimental_openThread(id);
					globalThis.__knightcodeDesktop!.experimental_conversationServices.experimental_setPanelOpen(true);
				}, id);
			},
			status: async () =>
				(
					await exec(
						join(installed, "resources", "knightcode", "knightcode.exe"),
						["desktop-ext", "status", "--json"],
						{ env: f.env },
					)
				).stdout,
		});
	} finally {
		const output = info.outputPath("packaged-backend.log");
		writeFileSync(output, logs.join("\n"));
		await info.attach("packaged-backend-output", { path: output, contentType: "text/plain" });
		for (const [name, path] of [
			["app-server.log", join(f.userData, "logs", "app-server.log")],
			["installed-app-server.log", join(f.env.APPDATA!, "KnightCode", "logs", "app-server.log")],
			["services.log", starts],
		])
			if (existsSync(path!)) await info.attach(name!, { path: path!, contentType: "text/plain" });
		if (child?.pid && child.exitCode === null)
			await exec(join(system32, "taskkill.exe"), ["/PID", String(child.pid), "/T", "/F"]).catch(() => {});
		await browser?.close();
		rmSync(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
}

test("packaged incompatible revisions retain both old pairs on preparation failure and reject old handles after commit", async ({}, info) => {
	test.setTimeout(180_000);
	await packaged(info, async (app) => {
		const second = await app.second();
		expect(await app.page.evaluate(() => window.__backendProofHandles!.at(-1)!.settings())).toEqual({
			status: "ok",
			value: { label: "Public label" },
		});
		expect(
			await app.page.evaluate(() => window.__backendProofHandles!.at(-1)!.setSetting("token", "leak")),
		).toMatchObject({ status: "error" });
		await app.page.getByRole("textbox", { name: "Message", exact: true }).fill("Retained canonical draft");
		app.version(2, { failPreparation: true });
		await expect.poll(app.status).toContain("Packaged preparation rejected");
		for (const page of [app.page, second]) {
			await expect(page.getByText("Backend revision 1", { exact: true })).toBeVisible();
			await page.getByRole("button", { name: "Echo backend" }).click();
			await expect(page.getByLabel("Backend echo")).toHaveText("7");
		}
		expect(readFileSync(app.starts, "utf8")).toBe("start:1\n");
		app.version(2);
		for (const page of [app.page, second]) {
			await expect(page.getByText("Backend revision 2", { exact: true })).toBeVisible();
			await page.getByRole("button", { name: "Echo backend" }).click();
			await expect(page.getByLabel("Backend echo")).toHaveText("v2");
			expect(await page.evaluate(() => window.__backendProofHandles![0]!.echo())).toEqual({ status: "disconnected" });
		}
		await expect(app.page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(
			"Retained canonical draft",
		);
		await expect(app.page.getByRole("region", { name: "Packaged backend" })).toHaveCSS("color", "rgb(34, 113, 72)");
	});
});

test("packaged drain timeout retains both epochs and does not replay an admitted real write", async ({}, info) => {
	test.setTimeout(180_000);
	await packaged(info, async (app) => {
		const second = await app.second();
		await app.page.evaluate(() => {
			window.__backendProofOutcomes = [];
			void window
				.__backendProofHandles!.at(-1)!
				.slowWrite(9000)
				.then((result) => window.__backendProofOutcomes!.push(result));
		});
		await expect.poll(() => existsSync(app.started)).toBe(true);
		app.version(2);
		await expect.poll(app.status, { timeout: 20_000 }).toContain("drain-timeout");
		for (const page of [app.page, second])
			await expect(page.getByText("Backend revision 1", { exact: true })).toBeVisible();
		await expect.poll(() => existsSync(app.completed), { timeout: 20_000 }).toBe(true);
		expect(readFileSync(app.completed, "utf8")).toBe("1");
		await expect
			.poll(() => app.page.evaluate(() => window.__backendProofOutcomes))
			.toEqual([{ status: "ok", value: 1 }]);
		expect(readFileSync(app.starts, "utf8")).toBe("start:1\n");
	});
});

test("packaged post-commit mount failure revokes one renderer without rolling the healthy window back", async ({}, info) => {
	test.setTimeout(180_000);
	await packaged(info, async (app) => {
		const second = await app.second();
		const failWindow = await second.evaluate(() => window.knightcode.windowId);
		app.version(2, { failWindow });
		await expect(app.page.getByText("Backend revision 2", { exact: true })).toBeVisible();
		await expect(second.getByText("Backend revision 1", { exact: true })).toHaveCount(0);
		await expect(second.getByRole("region", { name: "Packaged backend" })).toHaveCount(0);
		expect(await second.evaluate(() => window.__backendProofHandles![0]!.echo())).toEqual({ status: "disconnected" });
		await app.page.getByRole("button", { name: "Echo backend" }).click();
		await expect(app.page.getByLabel("Backend echo")).toHaveText("v2");
	});
});

test("packaged server restart settles pending read/write outcomes and requires a fresh epoch handshake", async ({}, info) => {
	test.setTimeout(180_000);
	await packaged(info, async (app) => {
		await app.second();
		const before = readFileSync(app.pid, "utf8");
		await app.page.evaluate(() => {
			window.__backendProofOutcomes = [];
			const handles = window.__backendProofHandles!.at(-1)!;
			void handles.slowRead(20000).then((result) => window.__backendProofOutcomes!.push(result));
			void handles.slowWrite(20000).then((result) => window.__backendProofOutcomes!.push(result));
		});
		await expect.poll(() => existsSync(app.started)).toBe(true);
		await app.restart();
		await expect
			.poll(() => app.page.evaluate(() => window.__backendProofOutcomes?.map((result) => result.status).sort()))
			.toEqual(["disconnected", "outcome-unknown"]);
		await expect.poll(() => readFileSync(app.pid, "utf8")).not.toBe(before);
		await expect.poll(() => app.page.evaluate(() => window.__backendProofHandles?.length ?? 0)).toBeGreaterThan(1);
		expect(await app.page.evaluate(() => window.__backendProofHandles![0]!.echo())).toEqual({ status: "disconnected" });
		await app.page.getByRole("button", { name: "Echo backend" }).click();
		await expect(app.page.getByLabel("Backend echo")).toHaveText("7");
	});
});

test("packaged close midcall accounts for the real write and keeps the other window's backend alive", async ({}, info) => {
	test.setTimeout(180_000);
	await packaged(info, async (app) => {
		const second = await app.second();
		await second.evaluate(() => {
			void window.__backendProofHandles!.at(-1)!.slowWrite(1200);
		});
		await expect.poll(() => existsSync(app.started)).toBe(true);
		await second.close();
		await expect.poll(() => existsSync(app.completed)).toBe(true);
		await expect(app.page.getByLabel("Backend count")).toHaveText("1");
		expect(readFileSync(app.starts, "utf8")).toBe("start:1\n");
	});
});

test("packaged backend preparation failure retains live v1 RPC in both windows", async ({}, info) => {
	test.setTimeout(180_000);
	await packaged(info, async (app) => {
		const second = await app.second();
		app.version(2, { failBackend: true });
		await expect.poll(app.status).toContain("Packaged backend preparation rejected");
		for (const page of [app.page, second]) {
			await expect(page.getByText("Backend revision 1", { exact: true })).toBeVisible();
			expect(await page.evaluate(() => window.__backendProofHandles!.at(-1)!.echo())).toEqual({
				status: "ok",
				value: 7,
			});
		}
		expect(readFileSync(app.starts, "utf8")).toBe("start:1\n");
	});
});

test("packaged readiness timeout retains v1 and a newly opened window waits for the settled decision", async ({}, info) => {
	test.setTimeout(180_000);
	await packaged(info, async (app) => {
		const second = await app.second();
		const blockWindow = await second.evaluate(() => window.knightcode.windowId);
		app.version(2, { blockWindow });
		await expect.poll(() => second.locator('script[type="module"][src^="app://ext/"]').count()).toBe(2);
		const third = await app.second();
		await expect.poll(app.status, { timeout: 20_000 }).toMatch(/readiness|timed out|revoked/i);
		for (const page of [app.page, second, third]) {
			await expect(page.getByText("Backend revision 1", { exact: true })).toBeVisible();
			expect(await page.evaluate(() => window.__backendProofHandles!.at(-1)!.echo())).toEqual({
				status: "ok",
				value: 7,
			});
		}
		expect(readFileSync(app.starts, "utf8")).toBe("start:1\n");
	});
});

test("packaged closing a participant during preparation revokes it before the healthy window commits", async ({}, info) => {
	test.setTimeout(180_000);
	await packaged(info, async (app) => {
		const second = await app.second();
		const blockWindow = await second.evaluate(() => window.knightcode.windowId);
		app.version(2, { blockWindow });
		await expect.poll(() => second.locator('script[type="module"][src^="app://ext/"]').count()).toBe(2);
		await second.close();
		await expect(app.page.getByText("Backend revision 2", { exact: true })).toBeVisible();
		await app.page.getByRole("button", { name: "Echo backend" }).click();
		await expect(app.page.getByLabel("Backend echo")).toHaveText("v2");
	});
});

test("packaged backend activation failure disables both windows instead of reviving disposed v1", async ({}, info) => {
	test.setTimeout(180_000);
	await packaged(info, async (app) => {
		const second = await app.second();
		app.version(2, { failStart: true });
		await expect.poll(app.status).toContain("Packaged backend start failed");
		for (const page of [app.page, second]) {
			await expect(page.getByRole("region", { name: "Packaged backend" })).toHaveCount(0);
			expect(await page.evaluate(() => window.__backendProofHandles![0]!.echo())).toEqual({ status: "disconnected" });
		}
		expect(readFileSync(app.starts, "utf8")).toBe("start:1\nstop:1\n");
	});
});

test("packaged failed old-service teardown disables all windows without overlapping service generations", async ({}, info) => {
	test.setTimeout(180_000);
	await packaged(info, async (app) => {
		const second = await app.second();
		const before = await app.page.evaluate(() => window.__backendProofHandles!.length);
		app.version(1, { failStop: true });
		await expect.poll(() => app.page.evaluate(() => window.__backendProofHandles!.length)).toBeGreaterThan(before);
		app.version(2);
		await expect.poll(app.status).toContain("Backend service shutdown failed");
		for (const page of [app.page, second])
			await expect(page.getByRole("region", { name: "Packaged backend" })).toHaveCount(0);
		expect(readFileSync(app.starts, "utf8")).not.toContain("start:2");
	});
});

test("packaged cancellation reports an unknown write outcome while its real completion is counted once", async ({}, info) => {
	test.setTimeout(180_000);
	await packaged(info, async (app) => {
		expect(await app.page.evaluate(() => window.__backendProofHandles!.at(-1)!.cancelWrite(1200))).toEqual({
			status: "outcome-unknown",
		});
		await expect.poll(() => existsSync(app.completed)).toBe(true);
		expect(readFileSync(app.completed, "utf8")).toBe("1");
		await expect(app.page.getByLabel("Backend count")).toHaveText("1");
	});
});

test("packaged public page, live panel tab and settings use the same admitted backend", async ({}, info) => {
	test.setTimeout(180_000);
	await packaged(info, async (app) => {
		await app.page.getByRole("button", { name: "Backend proof page", exact: true }).click();
		const content = app.page.getByRole("main").getByRole("region", { name: "Packaged backend" });
		await expect(content).toBeVisible();
		await content.getByRole("button", { name: "Echo backend" }).click();
		await expect(content.getByLabel("Backend echo")).toHaveText("7");
		expect(
			await app.page.evaluate(() => window.__backendProofHandles!.at(-1)!.setSetting("label", "Updated public label")),
		).toEqual({ status: "ok", value: { label: "Updated public label" } });
		await app.thread();
		await expect(app.page.getByRole("tab", { name: "Live backend proof", exact: true })).toHaveCount(0);
		await app.page.getByRole("button", { name: "Hide sidebar", exact: true }).click();
		await app.page.getByRole("tab", { name: "Live backend proof", exact: true }).click();
		const panel = app.page.getByRole("tabpanel");
		await expect(panel.getByText("Backend revision 1", { exact: true })).toBeVisible();
		await app.page.evaluate(() => window.__backendProofHandles!.at(-1)!.slowWrite(10));
		await expect(panel.getByLabel("Backend count")).toHaveText("1");
		expect(await app.page.evaluate(() => window.__backendProofHandles!.at(-1)!.settings())).toEqual({
			status: "ok",
			value: { label: "Updated public label" },
		});
	});
});

test("packaged renderer crash during preparation revokes its authority and lets the healthy window commit", async ({}, info) => {
	test.setTimeout(180_000);
	await packaged(info, async (app) => {
		const second = await app.second();
		const blockWindow = await second.evaluate(() => window.knightcode.windowId);
		app.version(2, { blockWindow });
		await expect.poll(() => second.locator('script[type="module"][src^="app://ext/"]').count()).toBe(2);
		const session = await second.context().newCDPSession(second);
		void session.send("Page.crash").catch(() => {});
		await expect(app.page.getByText("Backend revision 2", { exact: true })).toBeVisible();
		await app.page.getByRole("button", { name: "Echo backend" }).click();
		await expect(app.page.getByLabel("Backend echo")).toHaveText("v2");
	});
});

test("packaged safe mode executes neither backend services nor external frontend modules", async ({}, info) => {
	test.setTimeout(180_000);
	await packaged(
		info,
		async (app) => {
			expect(existsSync(app.starts)).toBe(false);
			expect(existsSync(app.pid)).toBe(false);
			await expect(app.page.getByText("Backend revision 1", { exact: true })).toHaveCount(0);
			expect(await app.page.evaluate(() => window.__backendProofHandles)).toBeUndefined();
		},
		true,
	);
});
