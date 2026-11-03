// apps/bots/web/e2e/shell.e2e.ts
import { expect, test } from "./fixtures.ts";
import { compareToReference } from "./reference/compare.ts";
test("sidebar lists bots, groups, sections and needs-you markers", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByRole("navigation")).toContainText("Reviewer");
	await expect(page.getByTestId("needs-you")).toHaveCount(1);
	await page.keyboard.press("Control+K");
	await page.keyboard.type("Rev");
	await page.keyboard.press("Enter");
	await expect(page).toHaveURL(/\/bots\//);
});
test("shell matches the reference", async ({ page }) => compareToReference(page, "shell"));
test("the row menu pins, archives and restores a bot", async ({ page }) => {
	await page.goto("/bots/inbox");
	const nav = page.getByRole("navigation", { name: "Bots" });
	await nav.getByRole("link", { name: "Social" }).hover();
	await nav.getByRole("button", { name: "Social actions" }).click();
	await page.getByRole("menuitem", { name: "Archive" }).click();
	await expect(nav.getByRole("link", { name: "Social" })).toHaveCount(0);
	await page.getByRole("button", { name: "Open account menu" }).click();
	await page.getByRole("menuitem", { name: "Archived bots" }).click();
	await nav.getByRole("link", { name: "Social" }).hover();
	await nav.getByRole("button", { name: "Social actions" }).click();
	await page.getByRole("menuitem", { name: "Restore" }).click();
	await expect(nav.getByRole("link", { name: "Social" })).toHaveCount(0);
	await nav.getByRole("button", { name: /Back to bots/ }).click();
	await expect(nav.getByRole("link", { name: "Social" })).toHaveCount(1);
});
