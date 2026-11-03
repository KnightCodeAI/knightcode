// Cursor attention belongs to the creation preview, not the shape choices below the name field.
import { expect, test } from "./fixtures.ts";

test("only the creation preview follows the cursor, and only above the name field", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.clock.install();
	await page.goto("/new");
	const preview = page.locator(".kb-create__preview");
	const shapes = page.locator(".kb-avatar-picker__shapes [data-avatar]");
	await expect(preview.locator("svg")).toBeVisible();
	await page.clock.runFor(1500);
	const neutralPreview = await preview.innerHTML();
	const neutralShapes = await shapes.evaluateAll((elements) => elements.map((element) => element.innerHTML));

	await shapes.first().dispatchEvent("pointermove", {
		clientX: 850,
		clientY: 650,
		buttons: 0,
	});
	await page.clock.runFor(1000);
	expect(await preview.innerHTML()).toBe(neutralPreview);
	expect(await shapes.evaluateAll((elements) => elements.map((element) => element.innerHTML))).toEqual(neutralShapes);

	const box = await preview.boundingBox();
	if (!box) throw new Error("The creation preview has no bounds");
	await preview.dispatchEvent("pointermove", {
		clientX: box.x + 5,
		clientY: box.y + box.height / 2,
		buttons: 0,
	});
	await page.clock.runFor(1000);
	expect(await preview.innerHTML()).not.toBe(neutralPreview);
	expect(await shapes.evaluateAll((elements) => elements.map((element) => element.innerHTML))).toEqual(neutralShapes);

	await preview.dispatchEvent("pointerleave");
	await page.clock.runFor(1000);
	expect(await preview.innerHTML()).toBe(neutralPreview);
});
