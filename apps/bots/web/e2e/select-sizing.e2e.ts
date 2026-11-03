// Select options stay compact when portalled out of their trigger's settings row or dialog.
import { expect, test } from "./fixtures.ts";

for (const theme of ["dark", "light"] as const) {
	test(`details dropdowns match their triggers in ${theme} mode`, async ({ page }) => {
		await page.emulateMedia({ colorScheme: theme });
		await page.goto("/bots/reviewer/settings");
		for (const name of ["Model", "Thinking", "Approvals"]) {
			const trigger = page.getByRole("combobox", { name, exact: true });
			const fontSize = await trigger.evaluate((el) => getComputedStyle(el).fontSize);
			const control = await trigger.boundingBox();
			await trigger.click();
			const option = page.getByRole("option").first();
			await expect(option).toHaveCSS("font-size", fontSize);
			await expect(option).toHaveCSS("line-height", "18px");
			await expect(option).toHaveCSS("height", "28px");
			const popup = await page.getByRole("listbox").boundingBox();
			expect(popup!.width).toBeGreaterThanOrEqual(control!.width);
			expect(popup!.x + popup!.width).toBeLessThanOrEqual(page.viewportSize()!.width - 8);
			await page.keyboard.press("Escape");
		}
	});
}

test("dialog selects stay compact and support keyboard selection", async ({ page }) => {
	await page.goto("/bots/reviewer/settings?edit=1");
	const trigger = page.getByRole("dialog").getByRole("combobox", { name: "Notifications", exact: true });
	await trigger.focus();
	await page.keyboard.press("ArrowDown");
	const option = page.getByRole("option", { name: "Never", exact: true });
	await expect(option).toHaveCSS("font-size", "13px");
	await expect(option).toHaveCSS("height", "28px");
	await page.keyboard.press("End");
	await page.keyboard.press("Enter");
	await expect(trigger).toHaveText("Never");
	await expect(trigger).toBeFocused();
});
