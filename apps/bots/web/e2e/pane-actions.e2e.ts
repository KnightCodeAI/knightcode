// Details-pane actions sit at the right edge without a window-controls divider.
import { expect, test } from "./fixtures.ts";

for (const width of [1440, 390]) {
	test.describe(`pane actions at ${width}px`, () => {
		test.use({ viewport: { width, height: 900 } });

		test("right-aligns Share and Close without a divider", async ({ page }) => {
			await page.goto("/bots/reviewer?pane=details");
			const pane = page.getByRole("complementary", { name: "Conversation details" });
			const share = pane.getByRole("button", { name: "Share", exact: true });
			const close = pane.getByRole("button", { name: "Close", exact: true });
			await expect(share).toBeVisible();
			await expect(close).toBeVisible();
			const paneBox = (await pane.boundingBox())!;
			const shareBox = (await share.boundingBox())!;
			const closeBox = (await close.boundingBox())!;
			expect(paneBox.x + paneBox.width - closeBox.x - closeBox.width).toBeCloseTo(12, 0);
			expect(closeBox.x - shareBox.x - shareBox.width).toBeCloseTo(8, 0);
			await expect(pane.locator(".kb-pane__divider")).toHaveCount(0);
			await close.click();
			await expect(pane).toBeHidden();
		});
	});
}
