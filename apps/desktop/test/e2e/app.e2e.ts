/**
 * The desktop app end to end (desktop-shell.md section 16): the production Vite build in Electron, with a scratch
 * user-data and agent dir, against an app server whose model is the faux provider
 * (packages/cli/test/fixtures/faux-app-server.ts). No credentials, no network.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, type ElectronApplication, expect, type Page, test } from "@playwright/test";

const DESKTOP = resolve(__dirname, "../..");
const FAUX_SERVER = resolve(DESKTOP, "../../packages/cli/test/fixtures/faux-app-server.ts");
const COUNTER = resolve(DESKTOP, "../../packages/cli/examples/mcp-app/server.mjs");

test.beforeAll(() => {
	if (!existsSync(join(DESKTOP, ".vite/renderer/main_window/index.html")))
		throw new Error("No production build in apps/desktop/.vite: run `bun run package` first.");
});

interface Launched {
	app: ElectronApplication;
	page: Page;
	project: string;
}

const roots: string[] = [];
const apps: ElectronApplication[] = [];

test.afterEach(async () => {
	for (const app of apps.splice(0)) await app.close().catch(() => {});
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5 });
});

/** The app on a new thread in a fixture project, opened by a `knightcode://new?cwd=` link as the system would. */
async function launch(options: { counter?: boolean } = {}): Promise<Launched> {
	const root = mkdtempSync(join(tmpdir(), "kc-e2e-"));
	roots.push(root);
	const project = join(root, "project");
	const agentDir = join(root, "agent");
	mkdirSync(project);
	mkdirSync(agentDir);
	writeFileSync(join(project, "README.md"), "# e2e fixture\n");
	// The model a user would have picked: the new-thread composer offers the settings' default.
	writeFileSync(
		join(agentDir, "settings.json"),
		JSON.stringify({ defaultProvider: "faux-e2e", defaultModel: "faux-e2e" }),
	);
	if (options.counter)
		writeFileSync(
			join(agentDir, "mcp.json"),
			JSON.stringify({ mcpServers: { counter: { command: process.execPath, args: [COUNTER] } } }),
		);
	const app = await electron.launch({
		args: [
			DESKTOP,
			`--user-data-dir=${join(root, "userdata")}`,
			`knightcode://new?cwd=${encodeURIComponent(project)}`,
			// node_modules' chrome-sandbox has no setuid bit on a CI runner.
			...(process.platform === "linux" ? ["--no-sandbox"] : []),
		],
		env: {
			...process.env,
			KNIGHTCODE_CODING_AGENT_DIR: agentDir,
			// Plugins also read Claude Code's and Grok Build's folders; keep the developer's own out.
			CLAUDE_CONFIG_DIR: join(root, "claude"),
			GROK_HOME: join(root, "grok"),
			// Split on whitespace (src/main/server.ts): the checkout's path has no spaces in CI.
			KNIGHTCODE_DESKTOP_SERVER: `bun ${FAUX_SERVER}`,
		},
	});
	apps.push(app);
	const page = await app.firstWindow();
	await expect(page.getByText("Faux E2E")).toBeVisible();
	return { app, page, project };
}

async function send(page: Page, text: string): Promise<void> {
	const box = page.getByRole("textbox", { name: "Message" });
	await box.fill(text);
	await box.press("Enter");
}

test("a prompt gets the model's reply, and a bash call runs once approved", async () => {
	const { page } = await launch();
	await send(page, "say hello");
	await expect(page.getByText("Hello from the faux model.")).toBeVisible();

	await send(page, "run echo e2e-bash");
	await page.getByRole("button", { name: /^Allow once/ }).click();
	await expect(page.getByText("Ran it.")).toBeVisible();
	// A finished turn folds its work under one summary.
	await page
		.getByRole("button", { name: /^Worked for/ })
		.last()
		.click();
	await expect(page.getByText(/Ran echo e2e-bash/)).toBeVisible();
});

test("Stop interrupts a running turn", async () => {
	const { page } = await launch();
	await send(page, "count slowly");
	await expect(page.getByText(/^1 2 3/)).toBeVisible();
	await page.getByRole("button", { name: "Stop" }).click();
	await expect(page.getByText(/^Interrupted ·/)).toBeVisible();
});

test("an archived thread is found in Archived threads", async () => {
	const { page } = await launch();
	await send(page, "say hello");
	await expect(page.getByText("Hello from the faux model.")).toBeVisible();
	await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+A" : "Control+Shift+A");
	await page.getByRole("menubar").getByRole("button", { name: "File" }).click();
	await page.getByRole("menuitem", { name: "Archived Threads" }).click();
	await expect(page.getByText("say hello")).toBeVisible();
	await expect(page.getByRole("button", { name: "Unarchive" })).toBeVisible();
});

test("quitting over a running turn asks first: Cancel keeps the app, Quit ends it", async () => {
	const { app, page } = await launch();
	await send(page, "count slowly");
	await expect(page.getByText(/^1 2 3/)).toBeVisible();
	// The question is a native dialog, which a test cannot click: answer it in main, recording what it asked.
	const answer = (button: number) =>
		app.evaluate(({ dialog }, choice) => {
			const asked: string[] = [];
			Object.assign(globalThis, { asked });
			dialog.showMessageBoxSync = ((...args: unknown[]) => {
				asked.push((args.at(-1) as { message: string }).message);
				return choice;
			}) as typeof dialog.showMessageBoxSync;
		}, button);
	await answer(1);
	await app.evaluate(({ app: electronApp }) => electronApp.quit());
	await expect
		.poll(() => app.evaluate(() => (globalThis as unknown as { asked: string[] }).asked))
		.toEqual(["1 thread is running. Quit and interrupt it?"]);
	await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
	await answer(0);
	const closed = app.waitForEvent("close");
	await app.evaluate(({ app: electronApp }) => electronApp.quit());
	await closed;
});

test("a terminal runs a command in the thread's folder", async () => {
	const { page } = await launch();
	await send(page, "say hello");
	await expect(page.getByText("Hello from the faux model.")).toBeVisible();
	await page.keyboard.press("Control+Backquote");
	const terminal = page.locator(".xterm");
	await expect(terminal).toBeVisible();
	await terminal.click();
	// The shell joins kc- and "term", so the typed line never holds what it printed.
	await page.keyboard.type('echo kc-"term"');
	await page.keyboard.press("Enter");
	await expect(page.locator(".xterm-rows")).toContainText("kc-term");
});

test("a preview tab shows a page served on this machine", async () => {
	const server: Server = createServer((_request, response) => {
		response.writeHead(200, { "content-type": "text/html" });
		response.end("<!doctype html><title>E2E fixture page</title><h1>fixture</h1>");
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	try {
		const { page } = await launch();
		await send(page, "say hello");
		await expect(page.getByText("Hello from the faux model.")).toBeVisible();
		await page.keyboard.press(process.platform === "darwin" ? "Meta+T" : "Control+T");
		const address = page.getByRole("textbox", { name: "Address" });
		const { port } = server.address() as { port: number };
		await address.fill(`127.0.0.1:${port}`);
		await address.press("Enter");
		await expect(page.getByText("E2E fixture page")).toBeVisible();
	} finally {
		server.close();
	}
});

test("an MCP App draws in its tool's row and calls its server's tool once confirmed", async () => {
	const { page } = await launch({ counter: true });
	await send(page, "show the counter");
	await page.getByRole("button", { name: /^Allow once/ }).click();
	await expect(page.getByText("Here is the counter.")).toBeVisible();
	const app = page.frameLocator("iframe[src^='kc-mcp-app:']");
	await expect(app.locator("#count")).toHaveText("0");
	await app.getByRole("button", { name: "Add one" }).click();
	await page.getByRole("button", { name: "Run" }).click();
	await expect(app.locator("#count")).toHaveText("1");
});

test("a plugin installs, asks for trust, toggles, uninstalls, and offers its command", async () => {
	const { page, project } = await launch();
	const plugin = join(project, "..", "e2e-plugin");
	mkdirSync(join(plugin, "commands"), { recursive: true });
	writeFileSync(join(plugin, "plugin.json"), JSON.stringify({ name: "e2e-plugin", description: "E2E plugin" }));
	writeFileSync(join(plugin, "commands", "go.md"), "---\ndescription: Go somewhere\n---\nGo to $0\n");
	const mod = process.platform === "darwin" ? "Meta" : "Control";
	await page.keyboard.press(`${mod}+Comma`);
	await page.getByRole("button", { name: "Plugins" }).click();
	await page.getByRole("button", { name: "Install plugin" }).click();
	await page.getByRole("textbox", { name: "Source" }).fill(plugin);
	await page.getByRole("button", { name: "Install", exact: true }).click();
	// Installed untrusted; the trust dialog lists what it offers before anything runs.
	await expect(page.getByText("Trust e2e-plugin?")).toBeVisible();
	await expect(page.getByRole("dialog").getByText("Commands: /e2e-plugin:go")).toBeVisible();
	await page.getByRole("button", { name: "Trust and activate" }).click();
	await expect(page.getByText(/User · active/)).toBeVisible();
	await page.getByRole("switch", { name: "Enable e2e-plugin" }).click();
	await expect(page.getByText(/User · active/)).toBeHidden();
	await page.getByRole("switch", { name: "Enable e2e-plugin" }).click();
	await expect(page.getByText(/User · active/)).toBeVisible();
	// A new thread in the project offers the plugin's command before the thread exists. Back leaves Plugins, then
	// General, which opened Settings.
	await page.keyboard.press(`${mod}+BracketLeft`);
	await page.keyboard.press(`${mod}+BracketLeft`);
	await page.getByRole("textbox", { name: "Message" }).fill("/e2e");
	await expect(page.getByText("e2e-plugin:go")).toBeVisible();
	await page.keyboard.press(`${mod}+Comma`);
	await page.getByRole("button", { name: "Plugins" }).click();
	await page.getByRole("button", { name: "Uninstall e2e-plugin" }).click();
	await page.getByRole("button", { name: "Uninstall", exact: true }).click();
	await expect(page.getByText("No plugins", { exact: true })).toBeVisible();
	// The built-in marketplaces are offered without being added.
	await page.getByRole("tab", { name: "Marketplaces" }).click();
	await expect(page.getByRole("button", { name: "Add", exact: true })).toHaveCount(2);
	await expect(page.getByText("Anthropic · not added")).toBeVisible();
	await expect(page.getByText("xAI · not added")).toBeVisible();
});
