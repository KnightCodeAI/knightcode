/** Exercise S7 through real loaded extensions, the app server and a local Git remote. */
import { execFileSync } from "node:child_process";
import { cpSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect } from "@playwright/test";
import { MOD, openSettings, send, settle, test } from "../parity/harness.ts";

test("retains a Git write across remount, reload and two windows, retries only push, and opens a named viewer", async ({
	desktop,
}) => {
	const { page, project, root, env, agentDir, app } = desktop;
	const git = (...args: string[]) => execFileSync("git", args, { cwd: project, env, encoding: "utf8" }).trim();
	git("init", "-q", "-b", "main");
	git("config", "user.name", "Workspace Fixture");
	git("config", "user.email", "workspace@example.invalid");
	git("add", "README.md");
	git("commit", "-qm", "initial");
	const remote = join(root, "workspace-remote.git");
	git("init", "--bare", remote);
	git("remote", "add", "origin", remote);
	writeFileSync(join(project, "README.md"), "workspace extension file\n");
	const names = ["07-workspace", "09-file-viewer"];
	for (const name of names)
		cpSync(
			resolve(__dirname, "../../../../packages/cli/examples/desktop-extensions", name),
			join(agentDir, "desktop-extensions", name),
			{ recursive: true },
		);
	await app.evaluate(({ dialog }) => {
		dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
	});
	await send(page, "say hello");
	await expect(page.getByText("Hello from the faux model.")).toBeVisible();
	await openSettings(page, "Extensions & skills");
	for (const name of names) {
		const row = page.locator("[data-extension]").filter({ has: page.getByRole("heading", { name, exact: true }) });
		await row.getByRole("button", { name: "Trust frontend", exact: true }).click();
	}
	await page.keyboard.press(`${MOD}+N`);
	await page.getByRole("button", { name: /^say hello (?:Unpin|Pin) thread Archive thread$/ }).click();
	await page.getByRole("button", { name: "Show tabs", exact: true }).click();
	const workspace = page.getByRole("tab", { name: "Workspace example" });
	const file = page.getByRole("tab", { name: "File viewer example" });
	await file.click();
	await page.getByRole("button", { name: "Open README in example viewer" }).click();
	await expect(page.getByLabel("Example file contents")).toHaveText("workspace extension file");
	await workspace.click();
	await expect(page.getByText("main → main")).toBeVisible();

	// Keep commit in flight until the example has unmounted and a new instance has read the operation.
	writeFileSync(
		join(project, ".git", "hooks", "pre-commit"),
		"#!/bin/sh\nwhile [ ! -f .git/allow-commit ]; do sleep .1; done\n",
		{ mode: 0o755 },
	);
	writeFileSync(join(remote, "hooks", "pre-receive"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
	await page.getByRole("textbox", { name: "Example commit message" }).fill("One workspace commit");
	await page.getByRole("button", { name: "Example commit and push" }).click();
	try {
		await expect(page.getByText("running: commit", { exact: true })).toBeVisible();
		await file.click();
		await workspace.click();
		await expect(page.getByText("running: commit", { exact: true })).toBeVisible();
		await expect(page.getByRole("button", { name: "Example commit and push" })).toBeDisabled();
		await page.reload();
		await page.getByRole("button", { name: /^say hello (?:Unpin|Pin) thread Archive thread$/ }).click();
		await expect(page.getByText("Hello from the faux model.")).toBeVisible();
		if (await page.getByRole("button", { name: "Show tabs", exact: true }).isVisible())
			await page.getByRole("button", { name: "Show tabs", exact: true }).click();
		await workspace.click();
		await expect(page.getByText("running: commit", { exact: true })).toBeVisible();
		const opened = app.waitForEvent("window");
		await page.getByRole("button", { name: "Chat actions", exact: true }).click();
		await page.getByRole("menuitem", { name: "Open in new window", exact: true }).click();
		const second = await opened;
		await settle(app, second, "light", { width: 1280, height: 820 });
		if (await second.getByRole("button", { name: "Show tabs", exact: true }).isVisible())
			await second.getByRole("button", { name: "Show tabs", exact: true }).click();
		await second.getByRole("tab", { name: "Workspace example" }).click();
		await expect(second.getByText("running: commit", { exact: true })).toBeVisible();
		await expect(second.getByRole("button", { name: "Example commit and push" })).toBeDisabled();
		await second.close();
	} finally {
		writeFileSync(join(project, ".git", "allow-commit"), "");
	}
	await expect(page.getByText("partial: push", { exact: true })).toBeVisible();
	expect(git("log", "-1", "--format=%s")).toBe("One workspace commit");
	const head = git("rev-parse", "HEAD");
	writeFileSync(join(remote, "hooks", "pre-receive"), "#!/bin/sh\nexit 0\n");
	await page.getByRole("button", { name: "Retry remaining steps" }).click();
	await expect(page.getByText("completed: commit, push", { exact: true })).toBeVisible();
	expect(git("rev-parse", "HEAD")).toBe(head);
	expect(git("--git-dir", remote, "rev-parse", "refs/heads/main")).toBe(head);
});
