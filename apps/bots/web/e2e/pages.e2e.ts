// apps/bots/web/e2e/pages.e2e.ts
import { expect, test } from "./fixtures.ts";
import { compareToReference } from "./reference/compare.ts";
test("page blocks render safely and the inbox spans bots", async ({ page }) => {
	await page.goto("/pages/weekly");
	await expect(page.locator("script[data-from-page]")).toHaveCount(0);
	await expect(page.getByRole("img", { name: /chart/i })).toBeVisible();
	await page.goto("/inbox");
	await expect(page.getByRole("listitem")).toContainText(["Reviewer", "Inbox"]);
	await page.goto("/?away=5h");
	await expect(page.getByRole("heading", { name: "While you were away" })).toBeVisible();
});
for (const screen of ["pages", "page", "inbox", "catch-up"])
	test(`${screen} matches the reference`, async ({ page }) => compareToReference(page, screen));
