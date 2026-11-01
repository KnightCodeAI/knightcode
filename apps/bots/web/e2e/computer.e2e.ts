// apps/bots/web/e2e/computer.e2e.ts
import { expect, test } from "@playwright/test";
import { compareToReference } from "./reference/compare.ts";
test("take control, release, maintenance and teach", async ({ page }) => {
	await page.goto("/bots/reviewer/computer");
	await page.getByRole("button", { name: "Take control" }).click();
	await expect(page.getByText("You have control")).toBeVisible();
	await page.getByRole("button", { name: "Release control" }).click();
	await page.getByRole("button", { name: "More computer actions" }).click();
	for (const name of ["Stop computer", "Update computer", "Recover computer", "Reset computer"])
		await expect(page.getByRole("menuitem", { name })).toBeVisible();
	await page.keyboard.press("Escape");
	await page.getByRole("button", { name: "Teach a task" }).click();
	await expect(page.getByRole("button", { name: "Start recording" })).toBeVisible();
});
for (const screen of ["computer", "computer-takeover", "teach"])
	test(`${screen} matches the reference`, async ({ page }) => compareToReference(page, screen));
