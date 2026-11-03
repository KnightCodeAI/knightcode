// apps/bots/web/e2e/gallery.e2e.ts
import { expect, test } from "./fixtures.ts";
test("primitives gallery renders", async ({ page }) => {
	await page.goto("/__gallery");
	await expect(page.getByRole("button", { name: "Primary" })).toBeVisible();
	await expect(page).toHaveScreenshot("gallery.png");
});
