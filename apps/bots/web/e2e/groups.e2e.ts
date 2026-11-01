// apps/bots/web/e2e/groups.e2e.ts
import { expect, test } from "@playwright/test";
import { compareToReference } from "./reference/compare.ts";
test("group mentions, everyone, passes and a 2-to-10 member limit", async ({ page }) => {
	await page.goto("/groups/launch");
	await page.getByRole("textbox", { name: "Message" }).fill("@everyone status?");
	await page.getByRole("textbox", { name: "Message" }).press("Enter");
	await expect(page.getByTestId("turn-passed")).not.toHaveCount(0);
	await page.goto("/groups/launch/settings");
	await expect(page.getByText("2 to 10 bots")).toBeVisible();
});
test("group matches the reference", async ({ page }) => compareToReference(page, "group"));
