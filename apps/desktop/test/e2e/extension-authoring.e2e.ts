/** S3 packaged proof: a scripted, local-only agent uses the shipped binary without checkout/runtime resolution. */
import { execFile, spawn } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { delimiter, join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium, expect, test } from "@playwright/test";
import { createDesktopFixture } from "../fixtures/desktop.ts";

// Other native platforms need their own packaged app layout and native run, not a simulated Windows result.
test("packaged agent creates, validates, breaks, diagnoses and fixes a frontend extension", async ({}, info) => {
	test.skip(process.platform !== "win32", "Native packaged proof currently covers Windows only.");
	test.setTimeout(180_000);
	const fixture = createDesktopFixture({ theme: "light", nativeExtensions: true });
	const installed = join(fixture.root, "installed");
	const distribution = resolve(__dirname, "../../out/KnightCode-win32-x64");
	if (!existsSync(distribution)) throw new Error("Run stage-server.ts and desktop package first.");
	cpSync(distribution, installed, { recursive: true });
	const cli = join(installed, "resources", "knightcode", "knightcode.exe");
	const source = join(fixture.agentDir, "desktop-extensions", "proof");
	const sourceFile = join(source, "app.tsx");
	const commands = new Map<string, { name: string; arguments: object }>();
	const invoke = (args: string) => ({
		name: "bash",
		arguments: { command: `"${cli.replaceAll("\\", "/")}" desktop-ext ${args}` },
	});
	for (const [step, file] of [
		["author skill", "desktop-customization/SKILL.md"],
		["author guide", "desktop-extensions.md"],
		["author api", "desktop-api.md"],
		["author declarations", "desktop-sdk.d.ts"],
	]) {
		commands.set(step!, {
			name: "read",
			arguments: { path: join(installed, "resources", "knightcode", "docs", file!) },
		});
	}
	commands.set("author create", invoke("new proof --json"));
	commands.set("author validate", invoke(`validate "${source.replaceAll("\\", "/")}" --json`));
	commands.set("author status", invoke("status --json"));
	commands.set("author reload", invoke("reload --json"));
	const outputs: string[] = [];
	const stepOutputs = new Map<string, string[]>();
	let initialSystem = "";
	const requests: string[] = [];
	const model = createServer(async (request, response) => {
		let body = "";
		for await (const part of request) body += part.toString();
		const payload = JSON.parse(body) as {
			messages: { role: string; content: string | { type: string; text?: string }[] }[];
		};
		if (!requests.length) {
			const system = payload.messages.find((message) => message.role === "system")?.content;
			initialSystem = typeof system === "string" ? system : (system ?? []).map((part) => part.text ?? "").join("");
		}
		requests.push(body);
		const user = [...payload.messages].reverse().find((message) => message.role === "user")!;
		const prompt =
			typeof user.content === "string" ? user.content : user.content.map((part) => part.text ?? "").join("");
		const step = [...commands.keys()].find((key) => prompt.includes(key));
		const afterTool = payload.messages.at(-1)?.role === "tool";
		if (afterTool) {
			const content = payload.messages.at(-1)!.content;
			const output = typeof content === "string" ? content : content.map((part) => part.text ?? "").join("");
			outputs.push(output);
			if (step) stepOutputs.set(step, [...(stepOutputs.get(step) ?? []), output]);
		}
		response.writeHead(200, { "Content-Type": "text/event-stream" });
		const chunk = (delta: object, finish_reason: string | null) =>
			response.write(
				`data: ${JSON.stringify({ id: "proof", object: "chat.completion.chunk", created: 1, model: "proof", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
			);
		if (!afterTool && step) {
			const tool = commands.get(step)!;
			chunk(
				{
					role: "assistant",
					tool_calls: [
						{
							index: 0,
							id: `call-${requests.length}`,
							type: "function",
							function: { name: tool.name, arguments: JSON.stringify(tool.arguments) },
						},
					],
				},
				null,
			);
			chunk({}, "tool_calls");
		} else {
			chunk({ role: "assistant", content: `${step ?? "Unknown step"} complete.` }, null);
			chunk({}, "stop");
		}
		response.end("data: [DONE]\n\n");
	});
	await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
	const address = model.address();
	if (!address || typeof address === "string") throw new Error("Fixture model did not bind.");
	writeFileSync(
		join(fixture.agentDir, "models.json"),
		JSON.stringify({
			providers: {
				proof: {
					api: "openai-completions",
					baseUrl: `http://127.0.0.1:${address.port}/v1`,
					apiKey: "local-fixture-only",
					models: [
						{
							id: "proof",
							name: "Authoring proof",
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
		join(fixture.agentDir, "settings.json"),
		JSON.stringify({
			defaultProvider: "proof",
			defaultModel: "proof",
			shellPath: join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe"),
			cacheWarming: "off",
		}),
	);
	const system32 = join(process.env.SystemRoot ?? "C:\\Windows", "System32");
	const env: Record<string, string> = {
		...fixture.env,
		PATH: [system32, join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "cmd")].join(delimiter),
	};
	delete env.Path;
	let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
	let child: ReturnType<typeof spawn> | undefined;
	const logs: string[] = [];
	try {
		for (const runtime of ["node", "bun"]) {
			const which = await promisify(execFile)(join(system32, "where.exe"), [runtime], { env }).catch(() => undefined);
			expect(which).toBeUndefined();
		}
		// Packaging disables the main-process Node inspector. Use renderer CDP without changing any fuse.
		child = spawn(
			join(installed, "knightcode-desktop.exe"),
			[
				`--user-data-dir=${fixture.userData}`,
				"--remote-debugging-port=0",
				`knightcode://new?cwd=${encodeURIComponent(fixture.project)}`,
			],
			{ cwd: fixture.project, env, stdio: ["ignore", "pipe", "pipe"] },
		);
		child.stdout?.on("data", (data) => logs.push(String(data)));
		child.stderr?.on("data", (data) => logs.push(String(data)));
		const portFile = join(fixture.userData, "DevToolsActivePort");
		await expect.poll(() => existsSync(portFile)).toBe(true);
		const port = readFileSync(portFile, "utf8").split(/\r?\n/)[0];
		browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
		const context = browser.contexts()[0]!;
		context.setDefaultTimeout(10_000);
		const page = context.pages()[0] ?? (await context.waitForEvent("page"));
		page.on("console", (message) => logs.push(`[renderer ${message.type()}] ${message.text()}\n`));
		page.on("pageerror", (error) => logs.push(`[pageerror] ${error.stack}\n`));
		await expect(page.getByText("Authoring proof").first()).toBeVisible();
		await page.exposeFunction("recordProofToast", (text: string) => logs.push(`[toast] ${text}\n`));
		await page.evaluate(() => {
			let last = "";
			new MutationObserver(() => {
				const text = document.querySelector('[role="status"]')?.textContent ?? "";
				if (text && text !== last)
					(window as unknown as { recordProofToast(text: string): void }).recordProofToast(text);
				last = text;
			}).observe(document.body, { childList: true, subtree: true, characterData: true });
		});
		const step = async (prompt: string) => {
			console.log("Packaged agent step:", prompt);
			const completed = page.getByText(`${prompt} complete.`, { exact: true });
			const before = await completed.count();
			await page.getByRole("textbox", { name: "Message", exact: true }).fill(prompt);
			await page.getByRole("button", { name: "Send", exact: true }).click();
			if (commands.get(prompt)?.name !== "read") {
				const approval = page.getByRole("button", { name: /^Allow once/ });
				await expect(approval).toBeVisible();
				await approval.click();
			}
			await expect(completed).toHaveCount(before + 1);
			console.log("Packaged agent completed:", prompt);
		};
		for (const prompt of ["author skill", "author guide", "author api", "author declarations"]) await step(prompt);
		await step("author create");
		const good = readFileSync(sourceFile, "utf8");
		await step("author validate");
		// Consent is supplied by the harness, not the agent or the shipped CLI. Native consent UI is covered separately.
		await promisify(execFile)("bun", [
			resolve(__dirname, "../../../../packages/cli/test/fixtures/desktop-approve.ts"),
			fixture.agentDir,
			source,
		]);
		await step("author reload");
		await expect(page.getByText("Desktop extension ready", { exact: true })).toBeVisible();
		commands.set("author break", {
			name: "write",
			arguments: {
				path: sourceFile,
				content:
					'import {defineDesktopExtension} from "@knightcodeai/cli/desktop"; export default defineDesktopExtension(() => { throw new Error("Packaged deliberate failure"); });',
			},
		});
		await step("author break");
		await step("author reload");
		await expect(page.getByText("Desktop extension ready", { exact: true })).toBeVisible();
		await step("author status");
		expect(outputs.join("\n")).toContain("Packaged deliberate failure");
		commands.set("author fix", {
			name: "write",
			arguments: { path: sourceFile, content: good.replace("Desktop extension ready", "Packaged extension fixed") },
		});
		await step("author fix");
		await expect(page.getByText("Packaged extension fixed", { exact: true })).toBeVisible();
		await step("author validate");
		await step("author status");
		expect(initialSystem).toContain("<name>desktop-customization</name>");
		const stepResults = (prompt: string) =>
			(stepOutputs.get(prompt) ?? []).map(
				(output) => JSON.parse(output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1)) as unknown,
			);
		expect(stepResults("author validate")).toHaveLength(2);
		for (const result of stepResults("author validate")) expect(result).toMatchObject({ valid: true, source });
		expect(stepResults("author reload")).toHaveLength(2);
		for (const result of stepResults("author reload"))
			expect(result).toMatchObject({ servers: [expect.anything()], unavailable: [] });
		expect(outputs.join("\n")).toContain("desktop-extensions.md");
		expect(outputs.join("\n")).toContain("# Desktop API inventory");
		expect(outputs.join("\n")).toContain("export declare function defineDesktopExtension");

		expect(outputs.at(-1)).toContain('"phase":"active"');
		const screenshot = info.outputPath("packaged-authoring.png");
		await page.screenshot({ path: screenshot });
		await info.attach("packaged-authoring", { path: screenshot, contentType: "image/png" });
		const results = info.outputPath("agent-tool-results.json");
		writeFileSync(results, JSON.stringify(outputs, null, 2));
		await info.attach("agent-tool-results", { path: results, contentType: "application/json" });
	} finally {
		console.log("Packaged proof cleanup", { modelRequests: requests.length, output: logs.join("") });
		await info.attach("model-requests", { body: JSON.stringify(requests, null, 2), contentType: "application/json" });
		for (const file of [
			join(fixture.userData, "logs", "app-server.log"),
			join(fixture.env.APPDATA, "KnightCode", "logs", "app-server.log"),
		]) {
			if (existsSync(file)) await info.attach("app-server.log", { path: file, contentType: "text/plain" });
		}
		console.log("Packaged proof diagnostics", { modelRequests: requests.length, output: logs.join("") });
		await info.attach("packaged-output", { body: logs.join(""), contentType: "text/plain" });
		if (browser) {
			const page = browser.contexts()[0]?.pages()[0];
			if (page)
				await info.attach("packaged-final", {
					body: await page.screenshot({ timeout: 5000 }).catch(() => Buffer.from("")),
					contentType: "image/png",
				});
		}
		if (child?.pid && child.exitCode === null) {
			await promisify(execFile)(join(system32, "taskkill.exe"), ["/PID", String(child.pid), "/T", "/F"]).catch(
				() => {},
			);
		}
		await browser?.close();
		model.closeAllConnections();
		await new Promise<void>((resolve) => model.close(() => resolve()));
		rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});
