// apps/bots/web/e2e/routines.e2e.ts
import { expect, test } from "@playwright/test";
import { compareToReference } from "./reference/compare.ts";
test("create a routine with a grant and every trigger kind available", async ({ page }) => {
	await page.goto("/bots/reviewer/routines/new");
	await page.getByRole("button", { name: "Add trigger" }).click();
	for (const kind of ["Schedule", "GitHub", "Slack", "Email", "App event", "Webhook", "Watch for changes"])
		await expect(page.getByRole("menuitem", { name: kind })).toBeVisible();
	await page.getByRole("menuitem", { name: "Watch for changes" }).click();
	await page.getByRole("combobox", { name: "What to watch" }).selectOption("command");
	await expect(page.getByTestId("computer-hours-estimate")).toBeVisible();
	await expect(page.getByRole("group", { name: "Allowed actions" })).toBeVisible();
});
for (const screen of ["routines", "routine-edit", "activity", "usage"])
	test(`${screen} matches the reference`, async ({ page }) => compareToReference(page, screen));
