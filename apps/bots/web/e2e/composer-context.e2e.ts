// Draft context grows upward; the composer controls stay beside the message field at the bottom.
import { expect, test } from "./fixtures.ts";

for (const width of [1280, 390]) {
	for (const action of ["reply", "quote", "attachment"] as const) {
		test(`${action} context keeps composer controls at the bottom at ${width}px`, async ({ page }) => {
			await page.setViewportSize({ width, height: 900 });
			await page.goto("/bots/reviewer?pane=closed");
			const composer = page.locator('[data-ref="composer"]');
			const field = composer.getByRole("textbox", { name: "Message" });
			await field.fill("Keep this draft");
			const controls = composer.locator(".kb-composer__leading, .kb-composer__trailing");
			const controlPositions = () =>
				controls.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().y));
			const before = await controlPositions();

			if (action === "attachment") {
				await page.setInputFiles('input[type="file"]', {
					name: `${"long-attachment-name-".repeat(12)}.txt`,
					mimeType: "text/plain",
					buffer: Buffer.from("x"),
				});
			} else {
				const message = page.locator('[data-entry="r2"]');
				await message.hover();
				if (action === "reply") {
					await message.getByRole("button", { name: "Reply to Reviewer message" }).click();
				} else {
					await message.getByRole("button", { name: "More message actions" }).click();
					await page.getByRole("menuitem", { name: "Quote", exact: true }).click();
				}
			}

			const chip = composer.locator(".kb-chip");
			await expect(chip).toBeVisible();
			expect(await controlPositions()).toEqual(before);
			const chipBox = (await chip.boundingBox())!;
			const leadingBox = (await composer.locator(".kb-composer__leading").boundingBox())!;
			const composerBox = (await composer.boundingBox())!;
			const fieldRowBox = (await composer.locator(".kb-composer__pad").boundingBox())!;
			// Context uses the space above the controls, not the message field's side gutters.
			expect(chipBox.x).toBeLessThan(leadingBox.x + leadingBox.width);
			expect(chipBox.x + chipBox.width).toBeLessThan(composerBox.x + composerBox.width);
			expect(chipBox.y + chipBox.height).toBeLessThanOrEqual(fieldRowBox.y);
			const remove = chip.getByRole("button", { name: /^Remove / });
			await expect(remove).toBeInViewport();
			await remove.click();
			await expect(chip).toHaveCount(0);
			await expect(field).toHaveValue("Keep this draft");

			// Several attachment rows must grow upward without moving the bottom controls either.
			await page.setInputFiles(
				'input[type="file"]',
				[1, 2, 3].map((index) => ({
					name: `${index}-${"long-attachment-name-".repeat(12)}.txt`,
					mimeType: "text/plain",
					buffer: Buffer.from("x"),
				})),
			);
			await expect(chip).toHaveCount(3);
			expect(await controlPositions()).toEqual(before);
			await field.fill("First line\nSecond line\nThird line");
			expect(await controlPositions()).toEqual(before);
		});
	}
}
