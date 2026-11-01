// apps/bots/web/e2e/settings.e2e.ts
import { expect, test } from "@playwright/test";
import { compareToReference } from "./reference/compare.ts";
test("billing enforces the $5 minimum and shows the fee", async ({ page }) => {
	await page.goto("/settings/billing");
	await page.getByRole("spinbutton", { name: "Amount" }).fill("4");
	await expect(page.getByRole("button", { name: "Add credits" })).toBeDisabled();
	for (const amount of ["$5", "$15", "$25"]) await expect(page.getByRole("button", { name: amount })).toBeVisible();
});
test("vault never shows values and bot emails are human-friendly", async ({ page }) => {
	await page.goto("/settings/vault");
	await expect(page.getByTestId("vault-value")).toHaveCount(0);
	await page.goto("/settings/channels");
	await expect(page.getByText(/^reviewer\.[a-z0-9-]{3,20}@bots\.knightcode\.dev$/)).toBeVisible();
});
test("onboarding checklist items disappear when done", async ({ page }) => {
	await page.goto("/?onboarding=1");
	await expect(page.getByRole("list", { name: "Get started" }).getByRole("listitem")).toHaveCount(5);
	// KnightCode's own baseline of the checklist (the reference has no onboarding screen).
	await expect(page.getByRole("list", { name: "Get started" })).toHaveScreenshot("onboarding-checklist.png");
});
for (const screen of ["settings-account", "settings-approvals", "settings-vault", "settings-payments", "settings-channels", "settings-billing", "onboarding"])
	test(`${screen} matches the reference`, async ({ page }) => compareToReference(page, screen));
