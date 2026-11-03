// The overflow label stays centered in the header; conversation clusters reserve that space for the owner.
import { expect, test } from "./fixtures.ts";

test("group header overflow text is centered in its tile", async ({ page }) => {
	await page.goto("/groups/all-hands");
	const tile = page.locator("header .kb-group-avatar__more");
	await expect(tile).toHaveText("+4");
	await page.evaluate(() => document.fonts.ready);
	// Magnify the real tile so subpixel text offsets remain visible in the raster bounds.
	await tile.locator("..").evaluate((element) => { element.style.zoom = "4"; });
	const screenshot = await tile.screenshot();
	const offset = await page.evaluate(async (base64) => {
		const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
		const canvas = document.createElement("canvas");
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const context = canvas.getContext("2d")!;
		context.drawImage(bitmap, 0, 0);
		const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
		let left = canvas.width, right = -1, top = canvas.height, bottom = -1;
		for (let y = 0; y < canvas.height; y++) {
			for (let x = 0; x < canvas.width; x++) {
				const i = (y * canvas.width + x) * 4;
				if (data[i]! < 200 || data[i + 1]! < 200 || data[i + 2]! < 200) continue;
				left = Math.min(left, x);
				right = Math.max(right, x);
				top = Math.min(top, y);
				bottom = Math.max(bottom, y);
			}
		}
		bitmap.close();
		return { x: Math.abs((left + right + 1 - canvas.width) / 2), y: Math.abs((top + bottom + 1 - canvas.height) / 2), pixels: right >= left };
	}, screenshot.toString("base64"));
	expect(offset.pixels).toBe(true);
	expect(offset.x).toBeLessThanOrEqual(0.5);
	expect(offset.y).toBeLessThanOrEqual(0.5);
});
