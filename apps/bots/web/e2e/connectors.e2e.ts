// apps/bots/web/e2e/connectors.e2e.ts
import { expect, test } from "./fixtures.ts";
import { compareToReference } from "./reference/compare.ts";
test("catalog shows apps without source labels and connects with skills", async ({ page }) => {
	await page.goto("/connectors");
	await expect(page.getByRole("main")).not.toContainText(/Claude|xAI|Anthropic|Composio|marketplace/i);
	await page.getByRole("link", { name: "Gmail" }).click();
	await page.getByRole("button", { name: "Connect" }).click();
	await expect(page.getByRole("checkbox", { name: /Add Gmail's skills/ })).toBeChecked();
	await page.getByRole("textbox", { name: "Usage note" }).fill("x".repeat(501));
	await expect(page.getByText("500 characters")).toBeVisible();
});
for (const screen of ["catalog", "connector", "skills"])
	test(`${screen} matches the reference`, async ({ page }) => compareToReference(page, screen));
