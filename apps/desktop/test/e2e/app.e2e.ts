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

test("opening files from the tree keeps its folders open", async () => {
	const { page, project } = await launch();
	mkdirSync(join(project, "src", "lib"), { recursive: true });
	writeFileSync(join(project, "src", "a.ts"), "export const a = 1;\n");
	writeFileSync(join(project, "src", "lib", "b.ts"), "export const b = 2;\n");
	await send(page, "say hello");
	await expect(page.getByText("Hello from the faux model.")).toBeVisible();
	await page.keyboard.press(process.platform === "darwin" ? "Meta+P" : "Control+P");
	// A row's path is its section and its path there; a folder's ends in "/". Sticky rows repeat a folder's path.
	const row = (path: string) => page.locator(`[data-item-path="All files/${path}"]:not([data-file-tree-sticky-row])`);
	await row("src/").click();
	await row("src/lib/").click();
	// From the "Open file" tab, then from the file tab it opened.
	await row("src/lib/b.ts").click();
	await expect(page.getByRole("tab", { name: "b.ts" })).toHaveAttribute("aria-selected", "true");
	await row("src/a.ts").click();
	await expect(page.getByRole("tab", { name: "a.ts" })).toHaveAttribute("aria-selected", "true");
	await expect(row("src/")).toHaveAttribute("aria-expanded", "true");
	await expect(row("src/lib/")).toHaveAttribute("aria-expanded", "true");
	// Back on "Open file", over the same tree, the filter takes the typing again.
	await page.getByRole("tab", { name: "Open file" }).click();
	await expect(page.getByRole("textbox", { name: "Filter files" })).toBeFocused();
	// The filter's results follow the file beside too: its row selected on its tab, none on "Open file".
	await page.keyboard.type("a.ts");
	const result = page.locator('[data-item-path="src/a.ts"]');
	await page.getByRole("tab", { name: "a.ts" }).click();
	await expect(result).toHaveAttribute("aria-selected", "true");
	await page.getByRole("tab", { name: "Open file" }).click();
	await expect(result).not.toHaveAttribute("aria-selected", "true");
	await result.click();
	await expect(page.getByRole("tab", { name: "a.ts" })).toHaveAttribute("aria-selected", "true");
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
