// apps/bots/web/e2e/groups.e2e.ts
import { expect, test } from "./fixtures.ts";
import { compareToReference } from "./reference/compare.ts";
test("group mentions, everyone, passes and a 2-to-10 member limit", async ({ page }) => {
	await page.goto("/groups/launch");
	await page.getByRole("textbox", { name: "Message" }).fill("@everyone status?");
	await page.getByRole("textbox", { name: "Message" }).press("Enter");
	await expect(page.getByTestId("turn-passed")).not.toHaveCount(0);
	await page.getByRole("tab", { name: "Members", exact: true }).click();
	await expect(page.getByText("A group holds 2 to 10 bots and you.", { exact: false })).toBeVisible();
});
test("group matches the reference", async ({ page }) => compareToReference(page, "group"));
