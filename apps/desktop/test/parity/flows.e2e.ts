/** Pre-migration Electron screenshots of the behavior matrix's flows: requests, Git writes, windows and lifetimes. */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { capture, MOD, openSettings, type RunningDesktop, send, settle, test } from "./harness.ts";

async function reply(page: Page, prompt: string, answer: string): Promise<void> {
	await send(page, prompt);
	await expect(page.getByText(answer, { exact: true }).last()).toBeVisible();
	await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeHidden();
}

function fixtureGit(desktop: RunningDesktop) {
	return (...args: string[]) =>
		execFileSync(
			"git",
			["-c", "user.name=Parity", "-c", "user.email=parity@example.invalid", "-c", "core.autocrlf=false", ...args],
			{
				cwd: desktop.project,
				env: { ...desktop.env, GIT_AUTHOR_DATE: "2026-11-12T12:00:00Z", GIT_COMMITTER_DATE: "2026-11-12T12:00:00Z" },
				encoding: "utf8",
			},
		);
}

test("thread actions, pin, unread, rename, fork, archive and delete", async ({ desktop }) => {
	const { page } = desktop;
	await reply(page, "say hello", "Hello from the faux model.");
	await page.getByRole("button", { name: "Chat actions" }).click();
	await capture(desktop, "thread-menu");
	await page.keyboard.press("Escape");
	await page.keyboard.press(`${MOD}+Alt+R`);
	const title = page.getByRole("textbox", { name: "Thread title" });
	await expect(title).toBeFocused();
	await capture(desktop, "thread-rename");
	await title.fill("Parity thread");
	await title.press("Enter");
	await expect(page.getByText("Parity thread").first()).toBeVisible();
	await page.keyboard.press(`${MOD}+Alt+P`);
	await capture(desktop, "sidebar-pinned");
	await page.getByRole("button", { name: "Chat actions" }).click();
	await page.getByRole("menuitem", { name: "Fork", exact: true }).focus();
	await page.keyboard.press("ArrowRight");
	await expect(page.getByRole("menuitem", { name: "Fork thread", exact: true })).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(page.getByText("Parity thread").nth(1)).toBeVisible();
	await capture(desktop, "thread-forked");
	await page.keyboard.press(`${MOD}+Shift+U`);
	await page.keyboard.press(`${MOD}+N`);
	await capture(desktop, "sidebar-unread");
	await page.getByText("Parity thread").first().click();
	await page.keyboard.press(`${MOD}+Shift+A`);
	await openSettings(page, "Archived threads");
	await expect(page.getByRole("button", { name: "Unarchive" })).toBeVisible();
	await capture(desktop, "settings-archived-populated");
	await page.getByRole("button", { name: "Delete archived thread" }).first().click();
	const cancel = page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true });
	// Focus a deliberate control: the initially focused close button grows a delayed tooltip.
	await cancel.focus();
	await expect(page.getByRole("tooltip")).toHaveCount(0);
	await capture(desktop, "archived-delete-confirm");
	await cancel.click();
	await page.getByRole("button", { name: "Unarchive" }).first().click();
	await expect(page.getByText("No archived threads.")).toBeVisible();
});

test("thinking, a running turn, queued follow-up and stop", async ({ desktop }) => {
	const { page } = desktop;
	// Reasoning is no transcript row: it names the running status, and the finished turn shows only the reply.
	await send(page, "think first");
	await expect(page.getByText("Checking the fixture", { exact: true })).toBeVisible();
	await capture(desktop, "turn-thinking");
	await expect(page.getByText("Thought it through.")).toBeVisible();
	await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeHidden();
	await capture(desktop, "thread-after-thinking");
	await send(page, "wait for stop");
	await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
	await capture(desktop, "turn-running");
	await send(page, "a queued follow-up");
	await expect(page.getByRole("button", { name: "Queued message actions" })).toBeVisible();
	await capture(desktop, "composer-queued");
	await page.getByRole("button", { name: "Delete queued message" }).click();
	await page.getByRole("button", { name: "Stop", exact: true }).click();
	await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeHidden();
	await capture(desktop, "turn-stopped");
});

test.describe("extension requests", () => {
	test.use({ extras: { dialogs: true } });
	test("question, select, confirm, input, editor, denial and declarative view", async ({ desktop }) => {
		const { page } = desktop;
		await send(page, "ask a question");
		await expect(page.getByText("Which layout should the fixture use?")).toBeVisible();
		await capture(desktop, "request-question");
		await page.getByText("Compact", { exact: true }).click();
		await expect(page.getByText("Got your answer.")).toBeVisible();
		await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeHidden();
		await capture(desktop, "request-question-answered");
		const requests = [
			{ command: "/parity-select", title: "Choose a fixture layout", screen: "request-select" },
			{ command: "/parity-confirm", title: "Reset the fixture?", screen: "request-confirm" },
			{ command: "/parity-input", title: "Name the fixture", screen: "request-input" },
			{ command: "/parity-editor", title: "Edit the fixture notes", screen: "request-editor" },
		];
		await holdToasts(page);
		for (const request of requests) {
			// The space closes the command suggestions, so Enter sends instead of completing.
			await send(page, `${request.command} `);
			await expect(page.getByText(request.title, { exact: true })).toBeVisible();
			await capture(desktop, request.screen);
			await page.keyboard.press("Escape");
			await expect(page.getByText(request.title, { exact: true })).toBeHidden();
			await releaseToasts(page);
		}
		await send(page, "/parity-select ");
		await page.getByText("Comfortable", { exact: true }).click();
		await expect(page.getByText("Chose Comfortable.")).toBeVisible();
		await capture(desktop, "feedback-toast");
		await releaseToasts(page);
		await send(page, "/parity-view ");
		await expect(page.getByText("Fixture checks")).toBeVisible();
		await capture(desktop, "declarative-view");
		await send(page, "run echo denied");
		await expect(page.getByRole("button", { name: /^Allow once/ })).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeHidden();
		await capture(desktop, "approval-denied");
	});
});

test.describe("MCP App", () => {
	test.use({ extras: { counter: true } });
	test("approval, inline app and side panel", async ({ desktop }) => {
		const { page } = desktop;
		await send(page, "show the counter");
		await expect(page.getByRole("button", { name: /^Allow once/ })).toBeVisible();
		await capture(desktop, "mcp-app-approval");
		await page.getByRole("button", { name: /^Allow once/ }).click();
		await expect(page.getByText("Here is the counter.")).toBeVisible();
		const counter = page.frameLocator("iframe[src^='kc-mcp-app:']").first();
		await expect(counter.locator("#count")).toHaveText("0");
		await capture(desktop, "mcp-app-inline");
		await counter.getByRole("button", { name: "Add one" }).click();
		await expect(page.getByRole("button", { name: "Run" })).toBeVisible();
		// The dialog first focuses its close button, which grows a delayed tooltip; focus the decision instead.
		await page.getByRole("button", { name: "Run" }).focus();
		await capture(desktop, "mcp-app-tool-confirmation");
		await page.getByRole("button", { name: "Run" }).click();
		await expect(counter.locator("#count")).toHaveText("1");
		// The app moves, not copies: the row keeps a placeholder and the side panel's tab shows the app.
		await page.getByRole("button", { name: "Show the app in the side panel" }).click();
		await expect(page.getByText("Shown in the side panel.")).toBeVisible();
		await expect(page.locator("iframe[src^='kc-mcp-app:']")).toHaveCount(1);
		await expect(page.frameLocator("iframe[src^='kc-mcp-app:']").locator("#count")).toBeVisible();
		await capture(desktop, "mcp-app-side-panel");
	});
});

test("changes panel and diff file tab", async ({ desktop }) => {
	const { page, project } = desktop;
	const git = fixtureGit(desktop);
	const lines = (change: (i: number) => string) =>
		Array.from({ length: 30 }, (_, i) => `export const line${i + 1} = ${change(i)};\n`).join("");
	mkdirSync(join(project, "src"));
	writeFileSync(
		join(project, "src", "example.ts"),
		lines((i) => String(i + 1)),
	);
	writeFileSync(join(project, "src", "notes.ts"), "export const notes = 1;\n");
	git("init", "-q", "-b", "main");
	git("add", ".");
	git("commit", "-q", "-m", "Initial fixture");
	writeFileSync(join(project, "README.md"), "# Parity project\n\nA changed desktop fixture.\n");
	writeFileSync(
		join(project, "src", "example.ts"),
		lines((i) => (i === 14 ? '"fifteen"' : String(i + 1))),
	);
	await reply(page, "say hello", "Hello from the faux model.");
	await page.keyboard.press(`${MOD}+Shift+G`);
	await expect(page.getByText('"fifteen"').first()).toBeVisible();
	await capture(desktop, "changes-panel");
	await page.getByRole("button", { name: "Open file in a tab" }).last().click();
	await expect(page.getByRole("tab", { name: "example.ts" })).toHaveAttribute("aria-selected", "true");
	await expect(page.getByText("export const line30 = 30;").last()).toBeVisible();
	await capture(desktop, "file-tab-changes");
});

test("an edited file tab saves", async ({ desktop }) => {
	const { page, project } = desktop;
	mkdirSync(join(project, "src"));
	writeFileSync(join(project, "src", "notes.ts"), "export const notes = 1;\n");
	await reply(page, "say hello", "Hello from the faux model.");
	// Its own thread, with no Changes panel history: closing a comparison tab and then opening the tree sometimes
	// crashes the view on this baseline ("Path does not exist: Changed files/..."; see parity.md). The editor is
	// focused directly, since at 800px the code column is too narrow to click. An edit autosaves 3 s later, so only
	// the explicitly saved state is a stable screen.
	await page.keyboard.press(`${MOD}+P`);
	await expect(page.getByRole("textbox", { name: "Filter files" })).toBeFocused();
	const row = (path: string) => page.locator(`[data-item-path="All files/${path}"]:not([data-file-tree-sticky-row])`);
	await row("src/").click();
	await row("src/notes.ts").click();
	await expect(page.getByRole("tab", { name: "notes.ts" })).toHaveAttribute("aria-selected", "true");
	await expect(page.getByText("export const notes = 1;").last()).toBeVisible();
	await page.locator("[contenteditable=true]").last().focus();
	await page.keyboard.press(`${MOD}+Home`);
	await page.keyboard.press("End");
	await page.keyboard.type(" // edited");
	await page.keyboard.press(`${MOD}+S`);
	await expect
		.poll(() => readFileSync(join(project, "src", "notes.ts"), "utf8"))
		.toBe("export const notes = 1; // edited\n");
	await capture(desktop, "file-tab-saved");
});

test("Git writes, failures and recovery", async ({ desktop }) => {
	const { page, project, root } = desktop;
	const git = fixtureGit(desktop);
	git("init", "-q", "-b", "main");
	git("add", "README.md");
	git("commit", "-q", "-m", "Initial fixture");
	writeFileSync(join(project, "README.md"), "# Parity project\n\nA changed desktop fixture.\n");
	await reply(page, "say hello", "Hello from the faux model.");
	const gitAction = async (name: string, dialog: string) => {
		await page.getByRole("button", { name: "Toggle summary" }).click();
		await page.getByRole("button", { name: "Git actions", exact: true }).click();
		await page.getByRole("menuitem", { name, exact: true }).click();
		const opened = page.getByRole("dialog", { name: dialog, exact: true });
		await expect(opened).toBeVisible();
		// The commit and pull request cards load their change totals after opening; capture them settled.
		if (dialog !== "Work here") await expect(opened.locator(".text-git-added")).toBeVisible();
		return opened;
	};
	await holdToasts(page);
	let dialog = await gitAction("Commit", "Commit or push");
	await dialog.locator("textarea").fill("Change the fixture readme");
	await capture(desktop, "git-commit-message");
	await dialog.getByText("Commit", { exact: true }).click();
	await expect.poll(() => git("log", "-1", "--format=%s").trim()).toBe("Change the fixture readme");
	await expect(page.getByText(/^Committed [0-9a-f]{7}: Change the fixture readme$/)).toBeVisible();
	await capture(desktop, "git-committed");
	await releaseToasts(page);
	dialog = await gitAction("Create branch", "Work here");
	await dialog.getByRole("textbox", { name: "Branch name" }).fill("parity/created");
	await dialog.getByRole("button", { name: "Create", exact: true }).click();
	await expect.poll(() => git("branch", "--show-current").trim()).toBe("parity/created");
	await expect(page.getByText("Created parity/created")).toBeVisible();
	await capture(desktop, "git-branch-created");
	await releaseToasts(page);
	// No remote: creating a PR stops at its push.
	dialog = await gitAction("Create pull request", "Create pull request");
	await dialog.getByRole("textbox", { name: "Title" }).fill("Parity pull request");
	await expect(dialog.getByText("parity/created → main", { exact: true })).toBeVisible();
	await capture(desktop, "git-pull-request-form");
	await dialog.getByText("Create PR", { exact: true }).click();
	await expect(page.getByText("no remote to push to")).toBeVisible();
	await capture(desktop, "git-pull-request-no-remote");
	await releaseToasts(page);
	// A reachable remote: the push succeeds, then PR creation fails, because the fixture keeps gh off PATH.
	const remote = join(root, "remote.git");
	execFileSync("git", ["init", "-q", "--bare", remote], { env: desktop.env });
	git("remote", "add", "origin", remote);
	await dialog.getByText("Create PR", { exact: true }).click();
	await expect(page.getByText(/\bgh\b|GitHub CLI/).last()).toBeVisible();
	expect(
		execFileSync("git", ["--git-dir", remote, "branch", "--list", "parity/created"], { encoding: "utf8" }),
	).toContain("parity/created");
	await capture(desktop, "git-pull-request-gh-missing");
	await releaseToasts(page);
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog")).toHaveCount(0);
	// A remote that cannot be reached: the commit lands, then the push fails, and the next attempt is a plain push.
	git("remote", "set-url", "origin", join(root, "missing-remote.git"));
	writeFileSync(join(project, "README.md"), "# Parity project\n\nA pushed desktop fixture.\n");
	dialog = await gitAction("Commit", "Commit or push");
	await dialog.locator("textarea").fill("Push the fixture readme");
	await dialog.getByText("Commit and push", { exact: true }).click();
	await expect.poll(() => git("log", "-1", "--format=%s").trim()).toBe("Push the fixture readme");
	await expect(page.getByText(/^Committed [0-9a-f]{7}: Push the fixture readme$/)).toBeVisible();
	await expect(
		page
			.locator("[data-kind=error], [role=alert]")
			.or(page.getByText(/remote|repository/i))
			.last(),
	).toBeVisible();
	await capture(desktop, "git-push-failed");
	await releaseToasts(page);
	// Recovery as it stands: the card stays open on its pre-commit status (still +1 -1, Push disabled because it
	// last saw the branch level with its upstream). Reopened, it reads the status again and Push retries the push
	// alone, never a second commit.
	await expect(dialog.getByRole("button", { name: "Push", exact: true })).toBeDisabled();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog")).toHaveCount(0);
	dialog = await gitAction("Commit", "Commit or push");
	const commits = git("rev-list", "--count", "HEAD").trim();
	await capture(desktop, "git-push-retry");
	await dialog.getByText("Push", { exact: true }).click();
	await expect(page.getByText(/^git push failed: /)).toBeVisible();
	expect(git("rev-list", "--count", "HEAD").trim()).toBe(commits);
	await capture(desktop, "git-push-retry-failed");
	await releaseToasts(page);
});

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

test("terminal reattachment and background command", async ({ desktop }) => {
	const { page } = desktop;
	await reply(page, "say hello", "Hello from the faux model.");
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
	const printed = () => page.locator(".xterm-rows > div").filter({ hasText: /^Parity terminal\s*$/ });
	await expect(printed()).toHaveCount(1);
	// A focused terminal keeps the keys it is typed; the app's shortcuts need focus outside it.
	await page.getByRole("textbox", { name: "Message", exact: true }).focus();
	await page.keyboard.press(`${MOD}+N`);
	await expect(page.getByRole("heading", { level: 1 })).toContainText("What should we build");
	await page
		.getByRole("button", { name: /^say hello/ })
		.first()
		.click();
	await expect(printed()).toHaveCount(1);
	await page.getByRole("textbox", { name: "Message", exact: true }).focus();
	await capture(desktop, "terminal-after-thread-switch");
	// A reloaded window starts at Home; the thread's terminal process lives in main and reattaches when reopened.
	await page.reload();
	await expect(page.getByRole("heading", { level: 1 })).toContainText("What should we build");
	await capture(desktop, "window-after-reload");
	await page
		.getByRole("button", { name: /^say hello/ })
		.first()
		.click();
	await expect(page.getByText("Hello from the faux model.")).toBeVisible();
	await page.keyboard.press(`${MOD}+J`);
	await expect(page.locator(".xterm")).toBeVisible();
	await expect(printed()).toHaveCount(1);
	await page.getByRole("textbox", { name: "Message", exact: true }).focus();
	await capture(desktop, "terminal-after-reload");
	await page.getByRole("button", { name: "Hide the terminal" }).click();
	await send(page, "run background parity");
	await page.getByRole("button", { name: /^Allow once/ }).click();
	await expect(page.getByText("Started it.")).toBeVisible();
	await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeHidden();
	await page.getByRole("button", { name: "Toggle summary" }).click();
	await expect(page.getByText(/Background/).first()).toBeVisible();
	await capture(desktop, "background-command");
});

test("second window, navigation history and reconnect", async ({ desktop }) => {
	const { page, app, serverPid, serverHold } = desktop;
	await reply(page, "say hello", "Hello from the faux model.");
	await openSettings(page, "General");
	await page.keyboard.press(`${MOD}+BracketLeft`);
	await expect(page.getByText("Hello from the faux model.")).toBeVisible();
	await capture(desktop, "navigation-back");
	await page.keyboard.press(`${MOD}+BracketRight`);
	await expect(page.getByRole("heading", { name: "General", level: 1 })).toBeVisible();
	await page.keyboard.press(`${MOD}+BracketLeft`);
	const opened = app.waitForEvent("window");
	await page.getByRole("button", { name: "Chat actions" }).click();
	await page.getByRole("menuitem", { name: "Open in new window", exact: true }).click();
	const second = await opened;
	const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
	const theme = (await page.locator("html").getAttribute("data-theme")) === "dark" ? "dark" : "light";
	await settle(app, second, theme, size);
	await expect(second.getByText("Hello from the faux model.")).toBeVisible();
	await capture(desktop, "second-window", second);
	await second.close();
	// Held at its handshake, the restarted server leaves the window reconnecting until the hold is lifted.
	writeFileSync(serverHold, "");
	const pid = Number(readFileSync(serverPid, "utf8"));
	process.kill(pid);
	await expect(page.getByText("Reconnecting to KnightCode…")).toBeVisible();
	await expect.poll(() => Number(readFileSync(serverPid, "utf8"))).not.toBe(pid);
	await capture(desktop, "server-reconnecting");
	rmSync(serverHold);
	await expect(page.getByText("Reconnecting to KnightCode…")).toBeHidden();
	await expect(page.getByText("Hello from the faux model.")).toBeVisible();
	await capture(desktop, "server-reconnected");
});

test("settings persist across a restart", async ({ desktop }) => {
	const preferences = () =>
		JSON.parse(readFileSync(join(desktop.userData, "desktop-state.json"), "utf8")).preferences as Record<
			string,
			unknown
		>;
	await openSettings(desktop.page, "General");
	await desktop.page.getByLabel("Send shortcut").click();
	await desktop.page
		.getByRole("menuitemradio", { name: /\+Enter$/ })
		.or(desktop.page.getByRole("option", { name: /\+Enter$/ }))
		.click();
	await expect.poll(() => preferences().sendKey).toBe("modEnter");
	await openSettings(desktop.page, "Appearance");
	await desktop.page.getByText("Advanced", { exact: true }).click();
	await desktop.page.getByLabel("UI font size").fill("15");
	await desktop.page.getByLabel("UI font size").press("Enter");
	await expect.poll(() => preferences().uiFontSize).toBe(15);
	await openSettings(desktop.page, "Worktrees");
	await desktop.page.getByRole("textbox", { name: "Branch prefix" }).fill("parity/");
	await desktop.page.getByRole("textbox", { name: "Branch prefix" }).press("Tab");
	await desktop.relaunch();
	expect(preferences()).toMatchObject({ sendKey: "modEnter", uiFontSize: 15 });
	for (const [label, screen] of [
		["General", "settings-persisted-general"],
		["Appearance", "settings-persisted-appearance"],
		["Worktrees", "settings-persisted-worktrees"],
	]) {
		await openSettings(desktop.page, label);
		if (label === "Appearance") await desktop.page.getByText("Advanced", { exact: true }).click();
		await capture(desktop, screen);
	}
	await expect(desktop.page.getByRole("textbox", { name: "Branch prefix" })).toHaveValue("parity/");
});
