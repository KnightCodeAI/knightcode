// apps/bots/web/e2e/mobile.e2e.ts
import { devices, expect, test } from "@playwright/test";
// The iPhone 15 profile in Chromium: Playwright's WebKit on Windows folds the display's scaling into the phone window
// (innerWidth 355 against a 393 px layout viewport, even on a blank page), so every page would "scroll" there.
test.use({ ...devices["iPhone 15"], defaultBrowserType: "chromium" });
test("phone layout has no horizontal scroll and is installable", async ({ page }) => {
	await page.goto("/");
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
	await page.goto("/bots/reviewer");
	await expect(page.getByRole("textbox", { name: "Message" })).toBeInViewport();
	await expect(page).toHaveScreenshot("phone-chat.png");
});

test("phone opens the sidebar as a drawer and details as a sheet", async ({ page }) => {
	await page.goto("/bots/reviewer");
	const sidebar = page.getByRole("navigation", { name: "Bots" });
	await expect(sidebar).toBeHidden();
	await page.getByRole("button", { name: "Menu" }).click();
	await sidebar.getByRole("link", { name: "Inbox", exact: true }).click();
	await expect(page).toHaveURL(/\/bots\/inbox$/);
	await expect(sidebar).toBeHidden();
	const details = page.getByRole("complementary", { name: "Conversation details" });
	await expect(details).toBeHidden();
	await page.getByRole("button", { name: "View conversation details" }).click();
	await expect(details).toBeVisible();
	await details.getByRole("button", { name: "Close" }).click();
	await expect(details).toBeHidden();
	await expect(page.getByRole("textbox", { name: "Message" })).toBeInViewport();
});

test("notifications can be turned on for this device", async ({ page }) => {
	await page.goto("/settings/account");
	await expect(page.getByRole("switch", { name: "Notifications on this device" })).toBeVisible();
});
