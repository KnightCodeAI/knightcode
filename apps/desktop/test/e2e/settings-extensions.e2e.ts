/** S8: real loaded settings sections, epoch-bound backend settings, theme presets and previews through the loader. */
import { cpSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect } from "@playwright/test";
import { openSettings, test } from "../parity/harness.ts";

const examples = resolve(__dirname, "../../../../packages/cli/examples/desktop-extensions");

test("schema and custom settings sections, presets and theme previews work from a loaded extension", async ({
	desktop,
}) => {
	test.setTimeout(150_000);
	const { page, app, agentDir } = desktop;
	cpSync(join(examples, "10-settings"), join(agentDir, "desktop-extensions", "10-settings"), { recursive: true });
	await app.evaluate(({ dialog }) => {
		dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
	});
	await openSettings(page, "Extensions & skills");
	const row = page
		.locator("[data-extension]")
		.filter({ has: page.getByRole("heading", { name: "10-settings", exact: true }) });
	await row.getByRole("button", { name: "Trust native code", exact: true }).click();
	const owner = await row.getAttribute("data-extension");

	// The recovery page keeps only built-in sections.
	await expect(page.getByRole("heading", { name: "Example extension", exact: true })).toHaveCount(0);

	// A declarative section renders backend values and writes through the epoch-bound backend.
	await openSettings(page, "General");
	const section = page.locator(`[data-kc-owner="${owner}"]`).filter({ hasText: "Example extension" });
	await expect(section.getByRole("heading", { name: "Example extension", exact: true })).toBeVisible();
	const greeting = section.getByRole("switch", { name: "Show greeting", exact: true });
	await expect(greeting).toBeChecked();
	await greeting.click();
	await expect(greeting).not.toBeChecked();
	await section.getByRole("button", { name: "Density", exact: true }).click();
	await page.getByRole("menuitemradio", { name: "Compact", exact: true }).click();
	await expect(section.getByRole("button", { name: "Density", exact: true })).toContainText("Compact");
	const limit = section.getByRole("spinbutton", { name: "Item limit", exact: true });
	await limit.fill("42");
	await limit.press("Enter");
	await expect(limit).toHaveValue("42");
	// The built-in General page still comes first, unchanged.
	const headings = await page.getByRole("heading", { level: 2 }).allTextContents();
	expect(headings.slice(0, 5)).toEqual(["Permissions", "General", "Composer", "Notifications", "Example extension"]);

	// Values persist in the extension data store, not desktop-state.json or settings.json; the secret is never shown.
	const data = join(agentDir, "desktop-extension-data");
	const files = readdirSync(data, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
	const stored = files.map((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8")).join("\n");
	expect(stored).toContain('"greeting":false');
	expect(stored).toContain('"density":"compact"');
	expect(stored).toContain('"limit":42');
	await expect(page.getByText("server-only")).toHaveCount(0);
	await page.reload();
	await openSettings(page, "General");
	await expect(
		page.locator(`[data-kc-owner="${owner}"]`).getByRole("switch", { name: "Show greeting", exact: true }),
	).not.toBeChecked();

	// A preset is listed under the Theme menu and changes the theme only when chosen.
	await openSettings(page, "Appearance");
	await page.getByRole("radiogroup", { name: "Mode" }).locator("label").nth(1).click();
	const before = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--kc-accent"));
	await page.getByRole("button", { name: "Light theme", exact: true }).click();
	await page.getByRole("menuitemradio", { name: "Sea", exact: true }).click();
	await expect
		.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--kc-accent")))
		.not.toBe(before);
	await expect(page.getByRole("button", { name: "Light theme", exact: true })).toContainText("Custom");

	// A portal opened inside a theme preview follows the preview; the window keeps its theme.
	await page.getByRole("button", { name: "Open preview popup", exact: true }).click();
	const popup = page.getByRole("note", { name: "Preview popup" });
	await expect(popup).toHaveText("Previewed in dark");
	const container = popup.locator("xpath=..");
	await expect(container).toHaveAttribute("data-theme", "dark");
	await expect(container).toHaveAttribute("data-kc-owner", owner!);
	expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("light");
	const previewColor = await popup.evaluate((node) => getComputedStyle(node).color);
	// Live theme change: the preview flips to the other theme and its open portal follows.
	await page.getByRole("radiogroup", { name: "Mode" }).locator("label").nth(2).click();
	await expect(popup).toHaveText("Previewed in light");
	await expect(container).toHaveAttribute("data-theme", "light");
	await expect.poll(() => popup.evaluate((node) => getComputedStyle(node).color)).not.toBe(previewColor);
});
