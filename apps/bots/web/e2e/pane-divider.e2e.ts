// The details pane's frame must stay visible under sticky tabs and their scroll fade.
import { expect, test } from "./fixtures.ts";

for (const colorScheme of ["light", "dark"] as const) {
	for (const deviceScaleFactor of [1, 2]) {
		test.describe(`${colorScheme} pane divider at ${deviceScaleFactor}x`, () => {
			test.use({ colorScheme, deviceScaleFactor, viewport: { width: 1440, height: 420 } });

			test("stays continuous across tabs before and after scrolling", async ({ page }) => {
				await page.goto("/bots/reviewer");
				const pane = page.getByRole("complementary", { name: "Conversation details" });
				const scroll = pane.locator(".kb-pane__scroll");
				await expect(pane.getByRole("button", { name: "New routine", exact: true })).toBeVisible();
				await page.evaluate(() => document.fonts.ready);

				for (const tab of ["Details", "Library", "Computer"]) {
					await pane.getByRole("tab", { name: tab, exact: true }).click();
					await scroll.evaluate((element) => { element.scrollTop = 0; });
					for (const scrolled of [false, true]) {
						if (scrolled) {
							await scroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
							if (tab === "Details") expect(await scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
						}
						const box = (await pane.boundingBox())!;
						const strip = await page.screenshot({
							clip: { x: Math.floor(box.x), y: 0, width: 2, height: box.height },
							scale: "css",
						});
						const pixels = await page.evaluate(async (base64) => {
							const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
							const canvas = document.createElement("canvas");
							canvas.width = bitmap.width;
							canvas.height = bitmap.height;
							const context = canvas.getContext("2d")!;
							context.drawImage(bitmap, 0, 0);
							bitmap.close();
							const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
							// Compare every row to the unobstructed frame in the pane header, not a theme-specific colour.
							const reference = Array.from(data.slice(30 * canvas.width * 4, 31 * canvas.width * 4));
							let maxDifference = 0;
							for (let y = 1; y < canvas.height - 1; y++) {
								for (let channel = 0; channel < reference.length; channel++) {
									maxDifference = Math.max(maxDifference, Math.abs(data[y * canvas.width * 4 + channel]! - reference[channel]!));
								}
							}
							return { maxDifference, reference };
						}, strip.toString("base64"));
						// A continuous but entirely missing frame must not pass.
						expect(new Set(pixels.reference).size).toBeGreaterThan(2);
						expect(pixels.maxDifference, `${tab}, scrolled=${scrolled}`).toBeLessThanOrEqual(1);
					}
				}
			});
		});
	}
}
