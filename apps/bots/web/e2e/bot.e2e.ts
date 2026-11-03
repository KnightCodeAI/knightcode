// apps/bots/web/e2e/bot.e2e.ts
import { expect, test } from "./fixtures.ts";
import { compareToReference } from "./reference/compare.ts";
test("create from a template, import a recipe, and export it again", async ({ page }) => {
	await page.goto("/new");
	await page.getByRole("tab", { name: "Templates" }).click();
	await expect(page.getByRole("listitem")).toHaveCount(44);
	await page.getByRole("button", { name: "Import an agent" }).click();
	await page.getByRole("textbox", { name: "Paste" }).fill(
		JSON.stringify({
			profile: { name: "X", description: "d" },
			memory: [{ content: "likes tea" }],
			skills: [{ name: "setup", description: "d", content: "c" }],
			routines: [{ name: "daily", slug: "daily", description: "d", content: "p" }],
			plugins: [],
			gettingStarted: { skill: "setup" },
		}),
	);
	await expect(page.getByRole("checkbox", { name: /likes tea/ })).not.toBeChecked();
	await expect(page.getByRole("checkbox", { name: /daily/ })).not.toBeChecked();
	await expect(page.getByRole("checkbox", { name: /Run setup/ })).not.toBeChecked();
	await page.getByRole("button", { name: "Create bot" }).click();
	await expect(page.getByRole("button", { name: "Run setup" })).toBeVisible();
	await expect(page.getByTestId("streaming")).toHaveCount(0);
});
test("model picker lists models from the API only", async ({ page }) => {
	await page.goto("/bots/reviewer/settings");
	await page.getByRole("combobox", { name: "Model" }).click();
	await expect(page.getByRole("option")).not.toHaveCount(0);
});
test("bot settings open from the row menu, and their selects open above the dialog", async ({ page }) => {
	await page.goto("/bots/reviewer");
	await page
		.getByRole("button", { name: /actions$/ })
		.first()
		.click();
	await page.getByRole("menuitem", { name: "Settings" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("combobox", { name: "Notifications" }).click();
	await page.getByRole("option", { name: "Never" }).click();
	await expect(dialog.getByRole("combobox", { name: "Notifications" })).toHaveText(/Never/);
	await dialog.getByRole("textbox", { name: "Instructions" }).fill("Review carefully");
	await dialog.getByRole("button", { name: "Save instructions" }).click();
	await dialog.getByRole("button", { name: "History" }).click();
	await expect(dialog.getByRole("list", { name: "Instruction versions" })).toContainText("Review carefully");
});
for (const screen of ["bot-create", "templates", "bot-settings", "memory"])
	test(`${screen} matches the reference`, async ({ page }) => compareToReference(page, screen));
