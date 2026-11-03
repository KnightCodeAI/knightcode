// The bot identity pill reveals its details affordance without changing the panel toggle or stretching its contents.
import { expect, test } from "./fixtures.ts";

for (const colorScheme of ["light", "dark"] as const) {
	test.describe(`${colorScheme} identity pill`, () => {
		test.use({ colorScheme, reducedMotion: "no-preference" });

		test("expands around its center on hover and returns without stretching the avatar or name", async ({ page }) => {
			await page.goto("/bots/reviewer?pane=closed");
			await page.evaluate(() => document.fonts.ready);
			const pill = page.getByRole("button", { name: "View conversation details" });
			const chevron = pill.locator(".kb-identity__chevron");
			await expect(chevron).toHaveCSS("opacity", "0");
			const rest = (await pill.boundingBox())!;
			const avatar = (await pill.locator("[data-ref=header-avatar]").boundingBox())!;
			const name = (await pill.locator("[data-ref=header-name]").boundingBox())!;
			await pill.hover();
			await expect(chevron).toHaveCSS("opacity", "1");
			await expect.poll(async () => (await pill.boundingBox())!.width - rest.width).toBeCloseTo(18, 0);
			const expanded = (await pill.boundingBox())!;
			expect(expanded.x + expanded.width / 2).toBeCloseTo(rest.x + rest.width / 2, 0);
			expect(expanded.height).toBe(rest.height);
			expect((await pill.locator("[data-ref=header-avatar]").boundingBox())!.width).toBe(avatar.width);
			expect((await pill.locator("[data-ref=header-name]").boundingBox())!.width).toBe(name.width);
			await page.mouse.move(0, 100);
			await expect(chevron).toHaveCSS("opacity", "0");
			await expect.poll(async () => (await pill.boundingBox())!.width).toBeCloseTo(rest.width, 0);
		});

		test("an open pane suppresses the hover reveal until the pill closes it", async ({ page }) => {
			await page.goto("/bots/reviewer?pane=details");
			const pill = page.getByRole("button", { name: "View conversation details" });
			const chevron = pill.locator(".kb-identity__chevron");
			await page.evaluate(() => document.fonts.ready);
			const rest = (await pill.boundingBox())!;
			const background = await pill.evaluate((element) => getComputedStyle(element).backgroundColor);
			await pill.hover();
			await pill.evaluate(async (element) => {
				const icon = element.querySelector(".kb-identity__chevron")!;
				await Promise.all([...element.getAnimations(), ...icon.getAnimations()].map((animation) => animation.finished));
			});
			await expect(chevron).toHaveCSS("opacity", "0");
			await expect(pill).toHaveCSS("background-color", background);
			expect((await pill.boundingBox())!.width).toBe(rest.width);
			await pill.click();
			await expect(pill).toHaveAttribute("aria-expanded", "false");
			await pill.hover();
			await expect(chevron).toHaveCSS("opacity", "1");
		});

		test("keyboard focus reveals the chevron and preserves the details toggle", async ({ page }) => {
			await page.goto("/bots/reviewer?pane=closed");
			const pill = page.getByRole("button", { name: "View conversation details" });
			const pane = page.getByRole("complementary", { name: "Conversation details" });
			await pill.focus();
			await expect(pill).toHaveCSS("outline-style", "solid");
			await expect(pill.locator(".kb-identity__chevron")).toHaveCSS("opacity", "1");
			await page.keyboard.press("Enter");
			await expect(pill).toHaveAttribute("aria-expanded", "true");
			await expect(pane).toBeVisible();
			await expect(pill.locator(".kb-identity__chevron")).toHaveCSS("opacity", "0");
			await page.keyboard.press("Space");
			await expect(pill).toHaveAttribute("aria-expanded", "false");
			await expect(pane).toBeHidden();
		});
	});
}

test("reduced motion keeps the reveal but removes all pill transitions and press scaling", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/bots/reviewer?pane=closed");
	const pill = page.getByRole("button", { name: "View conversation details" });
	await pill.hover();
	await expect(pill.locator(".kb-identity__chevron")).toHaveCSS("opacity", "1");
	for (const element of [pill, pill.locator(".kb-identity__chevron"), pill.locator(".kb-identity__chevron svg")]) {
		await expect(element).toHaveCSS("transition-duration", "0s");
	}
	await page.mouse.down();
	await expect(pill).toHaveCSS("transform", "none");
	await page.mouse.up();
});

test.describe("touch identity pill", () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

	test("shows its affordance without hover and opens details on the first tap", async ({ page }) => {
		await page.goto("/bots/reviewer?pane=closed");
		const pill = page.getByRole("button", { name: "View conversation details" });
		await expect(pill.locator(".kb-identity__chevron")).toHaveCSS("opacity", "1");
		await pill.tap();
		const pane = page.getByRole("complementary", { name: "Conversation details" });
		await expect(pane).toBeVisible();
		await pane.getByRole("button", { name: "Close", exact: true }).tap();
		await expect(pane).toBeHidden();
	});

	test("long bot names leave room for the menu and chevron without horizontal overflow", async ({ page }) => {
		await page.goto("/bots/reviewer?pane=details");
		const pane = page.getByRole("complementary", { name: "Conversation details" });
		await pane.getByRole("textbox", { name: "Bot name", exact: true }).fill("An extremely long bot name that must still fit in the phone header");
		await pane.getByRole("textbox", { name: "Bot name", exact: true }).press("Tab");
		await pane.getByRole("button", { name: "Close", exact: true }).tap();
		const pill = page.getByRole("button", { name: "View conversation details" });
		await expect(pill.locator("[data-ref=header-name]")).toContainText("An extremely long bot name");
		const box = (await pill.boundingBox())!;
		expect(box.x).toBeGreaterThanOrEqual(52);
		expect(box.x + box.width).toBeLessThanOrEqual(338);
		await expect(pill.locator(".kb-identity__chevron")).toHaveCSS("opacity", "1");
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	});
});
