/** Pre-migration Electron screenshots of the rest of the behavior matrix: steer, paste, delete, Git branches, worktrees. */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { capture, MOD, openSettings, type RunningDesktop, send, test } from "./harness.ts";

async function reply(page: Page, prompt: string, answer: string): Promise<void> {
	await send(page, prompt);
	await expect(page.getByText(answer, { exact: true }).last()).toBeVisible();
	await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeHidden();
}

function fixtureGit(desktop: RunningDesktop) {
	return (...args: string[]) =>
		execFileSync("git", ["-c", "core.autocrlf=false", ...args], {
			cwd: desktop.project,
			env: { ...desktop.env, GIT_AUTHOR_DATE: "2026-11-12T12:00:00Z", GIT_COMMITTER_DATE: "2026-11-12T12:00:00Z" },
			encoding: "utf8",
		});
}

/** Toasts dismiss themselves after 5 s; held, each screenshot shows a fixed set until the test releases them. */
async function holdToasts(page: Page): Promise<void> {
	await page.evaluate(() => {
		const w = window as unknown as { heldToasts?: (() => void)[] };
		if (w.heldToasts) return;
		const held: (() => void)[] = [];
		w.heldToasts = held;
		const original = window.setTimeout;
		window.setTimeout = ((handler: TimerHandler, ms?: number, ...args: unknown[]) => {
			if (ms !== 5000 || typeof handler !== "function") return original(handler, ms, ...args);
			held.push(() => handler(...args));
			return 0;
		}) as typeof window.setTimeout;
	});
}

async function releaseToasts(page: Page): Promise<void> {
	await page.evaluate(() => {
		for (const dismiss of (window as unknown as { heldToasts: (() => void)[] }).heldToasts.splice(0)) dismiss();
	});
}

async function gitAction(page: Page, name: string, dialog: string) {
	await page.getByRole("button", { name: "Toggle summary" }).click();
	await page.getByRole("button", { name: "Git actions", exact: true }).click();
	await page.getByRole("menuitem", { name, exact: true }).click();
	const opened = page.getByRole("dialog", { name: dialog, exact: true });
	await expect(opened).toBeVisible();
	return opened;
}

test("steer, pasted image and thread delete", async ({ desktop }) => {
	const { page, app } = desktop;
	const message = page.getByRole("textbox", { name: "Message", exact: true });
	await send(page, "wait for stop");
	await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
	await message.fill("steer the running turn");
	await message.press(`${MOD}+Enter`);
	await expect(message).toHaveValue("");
	await capture(desktop, "composer-steered");
	await page.getByRole("button", { name: "Stop", exact: true }).click();
	await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeHidden();
	// A fixed 32×32 PNG on the system clipboard (main reads it back on paste), then a real Mod+V.
	const png = await app.evaluate(({ nativeImage }) =>
		nativeImage
			.createFromBitmap(Buffer.alloc(32 * 32 * 4, 128), { width: 32, height: 32 })
			.toPNG()
			.toString("base64"),
	);
	await message.focus();
	await page.evaluate(async (data) => {
		const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
		await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([bytes], { type: "image/png" }) })]);
	}, png);
	await page.keyboard.press(`${MOD}+V`);
	await expect(page.getByRole("button", { name: "Remove image" })).toBeVisible();
	await capture(desktop, "composer-pasted-image");
	await page.getByRole("button", { name: "Remove image" }).click();
	await page.getByRole("button", { name: "Chat actions" }).click();
	await page.getByRole("menuitem", { name: "Delete…" }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible();
	const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
	await cancel.focus();
	await capture(desktop, "thread-delete-confirm");
	await dialog.getByRole("button", { name: "Delete", exact: true }).click();
	await expect(page.getByText("No threads")).toBeVisible();
	await capture(desktop, "thread-deleted");
});

test("detached HEAD, switching branch and a generated commit message", async ({ desktop }) => {
	const { page, project } = desktop;
	const git = fixtureGit(desktop);
	git("init", "-q", "-b", "main");
	git("add", "README.md");
	git("commit", "-q", "-m", "Initial fixture");
	git("branch", "feature/parity");
	git("checkout", "-q", "--detach");
	writeFileSync(join(project, "README.md"), "# Parity project\n\nA changed desktop fixture.\n");
	await reply(page, "say hello", "Hello from the faux model.");
	let dialog = await gitAction(page, "Commit", "Commit or push");
	await expect(dialog.getByText(/Detached HEAD|New branch/).first()).toBeVisible();
	await capture(desktop, "git-commit-detached");
	await page.keyboard.press("Escape");
	await holdToasts(page);
	dialog = await gitAction(page, "Switch branch", "Switch branch");
	await dialog.getByText("feature/parity", { exact: true }).click();
	await expect.poll(() => git("branch", "--show-current").trim()).toBe("feature/parity");
	await expect(page.getByText("Switched to feature/parity")).toBeVisible();
	await capture(desktop, "git-switched");
	await releaseToasts(page);
	// A blank message is generated by the model: the faux model's reply becomes the subject.
	dialog = await gitAction(page, "Commit", "Commit or push");
	await dialog.getByText("Commit", { exact: true }).click();
	await expect.poll(() => git("log", "-1", "--format=%s").trim(), { timeout: 30_000 }).not.toBe("Initial fixture");
	await expect(page.getByText(/^Committed [0-9a-f]{7}: /)).toBeVisible();
	await capture(desktop, "git-committed-generated");
	await releaseToasts(page);
});

test("a thread in a new worktree", async ({ desktop }) => {
	const { page } = desktop;
	const git = fixtureGit(desktop);
	git("init", "-q", "-b", "main");
	git("add", "README.md");
	git("commit", "-q", "-m", "Initial fixture");
	await page.getByRole("button", { name: "Configure local environment" }).click();
	await page.getByRole("switch", { name: "New worktree" }).click();
	await page.keyboard.press("Escape");
	await reply(page, "say hello", "Hello from the faux model.");
	await expect.poll(() => git("worktree", "list").trim().split("\n").length).toBe(2);
	await capture(desktop, "thread-in-worktree");
	await page.getByRole("button", { name: "Toggle summary" }).click();
	await page.getByRole("button", { name: "Actions", exact: true }).click();
	await expect(page.getByRole("menu")).toBeVisible();
	await capture(desktop, "worktree-actions-menu");
	await page.keyboard.press("Escape");
});

test("diff hunk expansion and a terminal that exits", async ({ desktop }) => {
	const { page, project } = desktop;
	const git = fixtureGit(desktop);
	const lines = (change: (i: number) => string) =>
		Array.from({ length: 30 }, (_, i) => `export const line${i + 1} = ${change(i)};\n`).join("");
	mkdirSync(join(project, "src"));
	writeFileSync(
		join(project, "src", "example.ts"),
		lines((i) => String(i + 1)),
	);
	git("init", "-q", "-b", "main");
	git("add", ".");
	git("commit", "-q", "-m", "Initial fixture");
	writeFileSync(
		join(project, "src", "example.ts"),
		lines((i) => (i === 14 ? '"fifteen"' : String(i + 1))),
	);
	await reply(page, "say hello", "Hello from the faux model.");
	await page.keyboard.press(`${MOD}+Shift+G`);
	await expect(page.getByText('"fifteen"').first()).toBeVisible();
	await page
		.getByText(/^\d+ unmodified lines$/)
		.first()
		.click();
	await expect(page.getByText("export const line5 = 5;").first()).toBeVisible();
	await capture(desktop, "changes-hunk-expanded");
	await page.keyboard.press(`${MOD}+Shift+G`);
	await page.keyboard.press("Control+Backquote");
	const terminal = page.locator(".xterm");
	await expect(terminal).toBeVisible();
	await terminal.click();
	// cmd's startup banner prints the Windows build, which changes with OS updates; clear it before exiting.
	await page.keyboard.type("cls");
	await page.keyboard.press("Enter");
	await page.keyboard.type("exit");
	await page.keyboard.press("Enter");
	await expect(page.getByText("Shell exited")).toBeVisible();
	await page.getByRole("textbox", { name: "Message", exact: true }).focus();
	await capture(desktop, "terminal-exited");
});

test.describe("MCP App and settings with content", () => {
	test.use({ extras: { counter: true } });
	test("full screen app, MCP servers, a plugin and shortcut recording", async ({ desktop }) => {
		const { page, root } = desktop;
		await send(page, "show the counter");
		await page.getByRole("button", { name: /^Allow once/ }).click();
		await expect(page.getByText("Here is the counter.")).toBeVisible();
		await page.getByRole("button", { name: "Show the app in the side panel" }).click();
		await page.getByRole("button", { name: "Enter full screen" }).click();
		await expect(page.getByRole("button", { name: "Exit full screen" })).toBeVisible();
		await expect(page.frameLocator("iframe[src^='kc-mcp-app:']").locator("#count")).toHaveText("0");
		await capture(desktop, "mcp-app-full-screen");
		await page.getByRole("button", { name: "Exit full screen" }).click();
		await openSettings(page, "MCP servers");
		await expect(page.getByRole("button", { name: "Remove counter" })).toBeVisible();
		await capture(desktop, "settings-mcp-populated");
		const plugin = join(root, "parity-plugin");
		mkdirSync(join(plugin, "commands"), { recursive: true });
		writeFileSync(join(plugin, "plugin.json"), JSON.stringify({ name: "parity-plugin", description: "Parity plugin" }));
		writeFileSync(join(plugin, "commands", "go.md"), "---\ndescription: Go somewhere\n---\nGo to $0\n");
		await openSettings(page, "Plugins");
		await page.getByRole("button", { name: "Install from source" }).click();
		// Captured empty: the source field would hold the scratch path in an input value, which capture cannot rewrite.
		await expect(page.getByRole("textbox", { name: "Source" })).toBeVisible();
		await capture(desktop, "settings-plugin-install");
		await page.getByRole("textbox", { name: "Source" }).fill(plugin);
		await page.getByRole("button", { name: "Install", exact: true }).click();
		await expect(page.getByText("Trust parity-plugin?")).toBeVisible();
		await page.getByRole("dialog").getByRole("button", { name: "Not now" }).focus();
		await capture(desktop, "settings-plugin-trust");
		await page.getByRole("button", { name: "Not now" }).click();
		await expect(page.getByText("Not trusted", { exact: true })).toBeVisible();
		await capture(desktop, "settings-plugins-installed");
		await openSettings(page, "Keyboard shortcuts");
		await page.getByRole("button", { name: "Change shortcut for Open the command palette" }).first().click();
		await expect(page.locator('input[value="Press shortcut"]')).toBeVisible();
		await capture(desktop, "settings-shortcut-recording");
	});
});
