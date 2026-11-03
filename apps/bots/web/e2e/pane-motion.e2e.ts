// The right pane slides as one surface: its contents must not reflow with its animated outer width.
import { expect, test } from "./fixtures.ts";

for (const pane of [
	{ path: "/bots/reviewer", label: "Conversation details", trigger: "View conversation details" },
	{ path: "/groups/launch", label: "Group details", trigger: "View group details" },
]) {
	test.describe(pane.label, () => {
		test.use({ reducedMotion: "no-preference" });

		test("keeps the text fixed relative to the pane while closing and opening", async ({ page }) => {
			await page.goto(`${pane.path}?pane=details`);
			await page.evaluate(() => document.fonts.ready);
			const surface = page.locator(`aside[aria-label="${pane.label}"]`);
			const before = await surface.evaluate((element) => {
				const bounds = element.getBoundingClientRect();
				return {
					width: bounds.width,
					children: [".kb-pane__top", ".kb-pane__scroll", ".kb-pane__head", ".kb-pane__tabs"].map((selector) => {
						const child = element.querySelector(selector)!.getBoundingClientRect();
						return { selector, width: child.width, x: child.x - bounds.x };
					}),
				};
			});
			for (const closing of [true, false]) {
				if (closing) await surface.getByRole("button", { name: "Close", exact: true }).click();
				else await page.getByRole("button", { name: pane.trigger }).click();
				await surface.evaluate((element) => {
					const transition = element.getAnimations().find((animation) =>
						animation instanceof CSSTransition && animation.transitionProperty === "width",
					);
					if (!transition) throw new Error("The pane did not start its width transition");
					transition.pause();
					transition.currentTime = Number(transition.effect!.getTiming().duration) / 2;
				});
				const bounds = (await surface.boundingBox())!;
				expect(bounds.width).toBeGreaterThan(0);
				expect(bounds.width).toBeLessThan(before.width);
				for (const child of before.children) {
					const box = (await surface.locator(child.selector).boundingBox())!;
					expect(box.width, child.selector).toBeCloseTo(child.width, 0);
					expect(box.x - bounds.x, child.selector).toBeCloseTo(child.x, 0);
				}
				await surface.evaluate((element) => {
					for (const animation of element.getAnimations()) animation.finish();
				});
			}
		});

		for (const width of [320, 390]) {
			test(`fits its contents to a ${width}px phone`, async ({ page }) => {
				await page.setViewportSize({ width, height: 844 });
				await page.goto(`${pane.path}?pane=details`);
				const surface = page.getByRole("complementary", { name: pane.label });
				await expect(surface).toBeVisible();
				for (const selector of [".kb-pane__top", ".kb-pane__scroll"]) {
					expect((await surface.locator(selector).boundingBox())!.width).toBe(width);
				}
			});
		}
	});
}
