/** S1 integration: production built-ins plus a client-rendered registry fixture, not an external artifact loader. */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect } from "@playwright/test";
import { MOD, test } from "../parity/harness.ts";

test("built-in palette actions and toast posting use the public host and original owner roots", async ({ desktop }) => {
	const { page } = desktop;
	await page.keyboard.press(`${MOD}+K`);
	const palette = page.getByRole("dialog", { name: "Command palette" });
	const actions = palette.getByRole("group", { name: "Quick actions" });
	await expect(actions.locator('[data-kc-owner="builtin.commands"]')).toHaveCount(5);
	await actions.getByRole("option", { name: /Hide sidebar/ }).click();
	await expect(palette).toBeHidden();
	await expect(page.locator(".kc-sidebar-slot")).not.toHaveAttribute("data-open");
	await page.evaluate(() => {
		window.__knightcodeDesktop!.experimental_controllers.experimental_notify("Public SDK notice", "success");
	});
	const toast = page.getByRole("status", { name: "Notifications" });
	await expect(toast).toHaveText("Public SDK notice");
	await expect(page.locator('[data-kc-owner="builtin.feedback"]')).toContainText("Public SDK notice");
	await toast.getByRole("button", { name: "Close", exact: true }).click();
	await expect(toast).toBeEmpty();
});

test("a crashing provider falls back, a crashing slot stays isolated, and a new registration recovers", async ({
	desktop,
}) => {
	const directory = join(desktop.root, "surface-client");
	mkdirSync(directory);
	const bundle = join(directory, "fixture.js");
	execFileSync(
		"bun",
		["build", resolve(__dirname, "../fixtures/extension-surfaces.tsx"), "--target=browser", `--outfile=${bundle}`],
		{ stdio: "pipe" },
	);
	const html = join(directory, "index.html");
	writeFileSync(html, '<!doctype html><div id="root"></div><script src="./fixture.js"></script>');
	const window = await desktop.app.evaluate(async ({ BrowserWindow }, file) => {
		const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
		await win.loadFile(file);
		return win.id;
	}, html);
	const page = desktop.app
		.windows()
		.find((page) => page.url().endsWith("index.html") && page.url().includes("surface-client"))!;
	try {
		await expect(page.getByText("Built-in feedback", { exact: true })).toBeVisible();
		await expect(page.getByText("Healthy slot", { exact: true })).toBeVisible();
		await expect(page.locator('[data-kc-owner="builtin"]')).toHaveCount(1);
		await expect(page.locator('[data-kc-owner="broken"]')).toHaveCount(0);
		await expect(page.getByRole("status")).toContainText("external/view");
		await page.getByRole("button", { name: "Replace failed provider" }).click();
		await expect(page.getByText("Recovered provider", { exact: true })).toBeVisible();
		await expect(page.getByText("Built-in feedback", { exact: true })).toHaveCount(0);
		await page.getByRole("button", { name: "Remove provider" }).click();
		await expect(page.getByText("Built-in feedback", { exact: true })).toBeVisible();
		await expect(page.getByRole("status")).toContainText("external/view");
	} finally {
		await desktop.app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), window);
	}
});
