/** Pre-migration Electron screenshots against the real app server with the native faux model: the screen set. */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { capture, MOD, openSettings, send, test } from "./harness.ts";

test("home, retained draft, command palette and sidebar", async ({ desktop }) => {
	const { page } = desktop;
	await capture(desktop, "home");
	await page.getByRole("textbox", { name: "Message", exact: true }).fill("A draft that must survive navigation.");
	await capture(desktop, "home-draft");
	await page.keyboard.press(`${MOD}+K`);
	await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
	await capture(desktop, "palette");
	await page.getByRole("combobox", { name: "Search threads and commands" }).fill("Appearance");
	await capture(desktop, "palette-filtered");
	await page.keyboard.press("Escape");
	await page.keyboard.press(`${MOD}+B`);
	await capture(desktop, "sidebar-collapsed");
	await page.keyboard.press(`${MOD}+B`);
	await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(
		"A draft that must survive navigation.",
	);
});

test("composer menus, suggestions, permissions and attachment", async ({ desktop }) => {
	const { page, app, project } = desktop;
	const message = page.getByRole("textbox", { name: "Message", exact: true });
	await page.getByRole("button", { name: "Change permissions" }).click();
	await capture(desktop, "composer-permissions");
	await page.getByRole("menuitemradio", { name: /^Full access/ }).click();
	await expect(page.getByText("Allow full access?", { exact: true })).toBeVisible();
	await capture(desktop, "composer-full-access-confirmation");
	await page.keyboard.press("Escape");
	await page.getByRole("button", { name: "Faux E2E", exact: true }).click();
	await capture(desktop, "composer-model-picker");
	await page.keyboard.press("Escape");
	await message.fill("@READ");
	await expect(page.getByRole("button", { name: /README.md/ })).toBeVisible();
	await capture(desktop, "composer-file-suggestion");
	await message.press("Enter");
	await expect(message).toHaveValue("@README.md ");
	await message.fill("/");
	await expect(page.locator("[data-active=true]")).toBeVisible();
	await capture(desktop, "composer-command-suggestions");
	await message.press("Escape");
	await message.fill("");
	const image = join(project, "attachment.png");
	const png = await app.evaluate(({ nativeImage }) =>
		nativeImage
			.createFromBitmap(Buffer.alloc(32 * 32 * 4, 255), { width: 32, height: 32 })
			.toPNG()
			.toString("base64"),
	);
	writeFileSync(image, Buffer.from(png, "base64"));
	await app.evaluate(({ dialog }, path) => {
		dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
	}, image);
	await page.getByRole("button", { name: "Add files and more" }).click();
	await expect(page.getByRole("button", { name: /^Images/ })).toBeVisible();
	await capture(desktop, "composer-add-menu");
	await page.getByRole("button", { name: /^Images/ }).click();
	await expect(page.getByRole("img", { name: "attachment.png", exact: true })).toBeVisible();
	await capture(desktop, "composer-attachment");
});

test("terminal and local preview", async ({ desktop }) => {
	const { page } = desktop;
	const server = createServer((_request, response) => {
		response.writeHead(200, { "content-type": "text/html" });
		response.end(
			'<!doctype html><title>Parity preview</title><body style="font-family:Arial;padding:24px">' +
				"<h1>Parity preview</h1><p>A fixed local preview document.</p></body>",
		);
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	try {
		await send(page, "say hello");
		await expect(page.getByText("Hello from the faux model.")).toBeVisible();
		await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeHidden();
		await page.keyboard.press("Control+Backquote");
		const terminal = page.locator(".xterm");
		await expect(terminal).toBeVisible();
		await terminal.click();
		await page.keyboard.type(
			process.platform === "win32"
				? "prompt PARITY$G & cls & echo Parity terminal"
				: "PS1='PARITY> '; printf '\\033[2J\\033[HParity terminal\\n'",
		);
		await page.keyboard.press("Enter");
		await expect(page.locator(".xterm-rows > div").filter({ hasText: /^Parity terminal\s*$/ })).toHaveCount(1);
		await expect(page.locator(".xterm-rows > div").filter({ hasText: /^PARITY>\s*$/ })).toHaveCount(1);
		// An unfocused terminal has a steady cursor; the live focused cursor intentionally blinks.
		await page.getByRole("textbox", { name: "Message", exact: true }).focus();
		await capture(desktop, "terminal");
		await page.getByRole("button", { name: "Hide the terminal" }).click();
		await page.keyboard.press(`${MOD}+T`);
		const address = page.getByRole("textbox", { name: "Address", exact: true });
		const { port } = server.address() as { port: number };
		await address.fill(`127.0.0.1:${port}`);
		await address.press("Enter");
		await expect(page.getByRole("tab", { name: "Parity preview" })).toBeVisible();
		await capture(desktop, "preview");
	} finally {
		await new Promise<void>((done, reject) => server.close((error) => (error ? reject(error) : done())));
	}
});

test("every settings page", async ({ desktop }) => {
	const labels = [
		"General",
		"Appearance",
		"Models & accounts",
		"Archived threads",
		"Keyboard shortcuts",
		"Configuration",
		"Tools",
		"MCP servers",
		"Extensions & skills",
		"Plugins",
		"Worktrees",
		"About",
	];
	for (const [index, label] of labels.entries()) {
		await openSettings(desktop.page, label);
		// Each page has its own baseline; a broken later page cannot be hidden by the settings shell.
		await capture(desktop, `settings-${String(index + 1).padStart(2, "0")}`);
	}
});

test("thread, search, file tree, file tab, approval and completed tool", async ({ desktop }) => {
	const { page, project } = desktop;
	mkdirSync(join(project, "src"));
	writeFileSync(join(project, "src", "example.ts"), "export const answer = 42;\n");
	await send(page, "say hello");
	await expect(page.getByText("Hello from the faux model.")).toBeVisible();
	await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeHidden();
	await capture(desktop, "thread");
	await page.keyboard.press(`${MOD}+F`);
	await page.getByRole("textbox", { name: "Find in thread", exact: true }).fill("Hello");
	await capture(desktop, "thread-find");
	await page.keyboard.press("Escape");
	await page.keyboard.press(`${MOD}+P`);
	await expect(page.getByRole("textbox", { name: "Filter files" })).toBeFocused();
	await capture(desktop, "file-tree");
	await page.locator('[data-item-path="All files/src/"]:not([data-file-tree-sticky-row])').click();
	await page.locator('[data-item-path="All files/src/example.ts"]:not([data-file-tree-sticky-row])').click();
	await expect(page.getByRole("tab", { name: "example.ts" })).toHaveAttribute("aria-selected", "true");
	await expect(page.getByText("export const answer = 42;", { exact: false })).toBeVisible();
	await capture(desktop, "file-tab");
	await page.getByRole("button", { name: "Hide tabs", exact: true }).click();
	await send(page, "run echo parity");
	await expect(page.getByRole("button", { name: /^Allow once/ })).toBeVisible();
	await capture(desktop, "approval");
	await page.getByRole("button", { name: /^Allow once/ }).click();
	await expect(page.getByText("Ran it.")).toBeVisible();
	await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeHidden();
	await page
		.getByRole("button", { name: /^Worked for/ })
		.last()
		.click();
	await capture(desktop, "tool-completed");
});

test("Git and workspace dialogs", async ({ desktop }) => {
	const { page, project, env } = desktop;
	const git = (...args: string[]) =>
		execFileSync(
			"git",
			["-c", "user.name=Parity", "-c", "user.email=parity@example.invalid", "-c", "core.autocrlf=false", ...args],
			{
				cwd: project,
				env: { ...env, GIT_AUTHOR_DATE: "2026-11-12T12:00:00Z", GIT_COMMITTER_DATE: "2026-11-12T12:00:00Z" },
			},
		);
	git("init", "-q", "-b", "main");
	git("add", "README.md");
	git("commit", "-q", "-m", "Initial fixture");
	git("branch", "feature/parity");
	writeFileSync(join(project, "README.md"), "# Parity project\n\nA changed desktop fixture.\n");
	await page.getByRole("button", { name: "Configure local environment" }).click();
	await page.getByRole("switch", { name: "New worktree" }).click();
	await expect(page.getByRole("button", { name: /^Branch.*main/ })).toBeVisible();
	await capture(desktop, "workspace-new-worktree");
	await page.getByRole("button", { name: /^Branch/ }).click();
	await expect(page.getByText("feature/parity", { exact: true })).toBeVisible();
	await capture(desktop, "workspace-base-branch");
	await page.keyboard.press("Escape");
	// Keep this thread local: no setup scripts or worktree writes are needed to capture the dialogs.
	await page.getByRole("button", { name: "Configure local environment" }).click();
	await page.getByRole("switch", { name: "New worktree" }).click();
	await page.keyboard.press("Escape");
	await send(page, "say hello");
	await expect(page.getByText("Hello from the faux model.")).toBeVisible();
	await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeHidden();
	const actions = [
		{ name: "Commit", dialog: "Commit or push", screen: "git-commit" },
		{ name: "Create branch", dialog: "Work here", screen: "git-create-branch" },
		{ name: "Switch branch", dialog: "Switch branch", screen: "git-switch-branch" },
		{ name: "Create pull request", dialog: "Create pull request", screen: "git-pull-request" },
	];
	for (const action of actions) {
		await page.getByRole("button", { name: "Toggle summary" }).click();
		await page.getByRole("button", { name: "Git actions", exact: true }).click();
		await page.getByRole("menuitem", { name: action.name, exact: true }).click();
		await expect(page.getByRole("dialog", { name: action.dialog, exact: true })).toBeVisible();
		if (action.screen === "git-switch-branch")
			await expect(page.getByText("feature/parity", { exact: true })).toBeVisible();
		if (action.screen === "git-commit" || action.screen === "git-pull-request") {
			const dialog = page.getByRole("dialog", { name: action.dialog, exact: true });
			await expect(dialog.getByText("+1", { exact: true })).toBeVisible();
			await expect(dialog.getByText("-1", { exact: true })).toBeVisible();
			if (action.screen === "git-pull-request") {
				await expect(dialog.getByText("main → main", { exact: true })).toBeVisible();
			}
		}
		await capture(desktop, action.screen);
		await page.keyboard.press("Escape");
	}
	await page.getByRole("button", { name: "Toggle summary" }).click();
	await page.getByRole("button", { name: "Actions", exact: true }).click();
	await page.getByRole("menuitem", { name: "Move to worktree", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "Move changes to a worktree" })).toBeVisible();
	const confirm = page.getByRole("button", { name: "Move to worktree", exact: true });
	await expect(confirm).toBeEnabled();
	// Leave the close-button tooltip out of this scenario; capture a deliberate keyboard focus state.
	await confirm.focus();
	await expect(page.getByRole("tooltip")).toHaveCount(0);
	await capture(desktop, "workspace-handoff");
});

test.describe("untrusted project", () => {
	test.use({ untrustedProject: true });
	test("project trust remains host-owned", async ({ desktop }) => {
		await expect(desktop.page.getByRole("button", { name: "Trust", exact: true })).toBeVisible();
		await capture(desktop, "project-trust");
		await desktop.page.getByRole("button", { name: "Not now", exact: true }).click();
		await expect(desktop.page.getByRole("button", { name: "Trust", exact: true })).toBeHidden();
		await capture(desktop, "project-trust-deferred");
	});
});
