/**
 * Launching the desktop app for an end-to-end test: the production Vite build in Electron, with a scratch user-data
 * and agent dir (never the owner's real profile), against an app server whose model is the faux provider
 * (packages/cli/test/fixtures/faux-app-server.ts). No credentials, no network. Each test file calls
 * `useLaunchedApps()` so launched apps close and their folders go after every test.
 */

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, type ElectronApplication, expect, type Page, test } from "@playwright/test";

export const DESKTOP = resolve(__dirname, "../..");
const FAUX_SERVER = resolve(DESKTOP, "../../packages/cli/test/fixtures/faux-app-server.ts");
const COUNTER = resolve(DESKTOP, "../../packages/cli/examples/mcp-app/server.mjs");

export interface Launched {
	app: ElectronApplication;
	page: Page;
	project: string;
	agentDir: string;
	/** The scratch Electron profile (desktop-state.json lives here). */
	userData: string;
}

const roots: string[] = [];
const apps: ElectronApplication[] = [];

/** Registers the build check and the cleanup in the calling test file. */
export function useLaunchedApps(): void {
	test.beforeAll(() => {
		if (!existsSync(join(DESKTOP, ".vite/renderer/main_window/index.html")))
			throw new Error("No production build in apps/desktop/.vite: run `bun run package` first.");
	});
	test.afterEach(async () => {
		for (const app of apps.splice(0)) await app.close().catch(() => {});
		for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5 });
	});
}

/** The app on a new thread in a fixture project, opened by a `knightcode://new?cwd=` link as the system would. */
export async function launch(
	options: { counter?: boolean; projectSettings?: boolean; offline?: boolean } = {},
): Promise<Launched> {
	// Its long form: a Windows runner's temp dir is an 8.3 name (RUNNER~1), and git gives a repository's root long.
	const root = realpathSync.native(mkdtempSync(join(tmpdir(), "kc-e2e-")));
	roots.push(root);
	const project = join(root, "project");
	const agentDir = join(root, "agent");
	const userData = join(root, "userdata");
	mkdirSync(project);
	mkdirSync(agentDir);
	writeFileSync(join(project, "README.md"), "# e2e fixture\n");
	// Its own settings, which load only once the project is trusted.
	if (options.projectSettings) {
		mkdirSync(join(project, ".knightcode"));
		writeFileSync(join(project, ".knightcode", "settings.json"), "{}\n");
	}
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
			`--user-data-dir=${userData}`,
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
			...(options.offline ? { KNIGHTCODE_OFFLINE: "1" } : {}),
			// Split on whitespace (src/main/server.ts): the checkout's path has no spaces in CI.
			KNIGHTCODE_DESKTOP_SERVER: `bun ${FAUX_SERVER}`,
		},
	});
	apps.push(app);
	const page = await app.firstWindow();
	await expect(page.getByText("Faux E2E")).toBeVisible();
	return { app, page, project, agentDir, userData };
}

export async function send(page: Page, text: string): Promise<void> {
	const box = page.getByRole("textbox", { name: "Message" });
	await box.fill(text);
	await box.press("Enter");
}
