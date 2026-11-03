// apps/bots/web/e2e/routines.e2e.ts
import { expect, test } from "./fixtures.ts";
import { compareToReference } from "./reference/compare.ts";
test("create a routine with a grant and every trigger kind available", async ({ page }) => {
	await page.goto("/bots/reviewer/routines/new");
	await page.getByRole("button", { name: "Add trigger" }).click();
	for (const kind of ["Schedule", "GitHub", "Slack", "Email", "App event", "Webhook", "Watch for changes"])
		await expect(page.getByRole("menuitem", { name: kind })).toBeVisible();
	await page.getByRole("menuitem", { name: "Watch for changes" }).click();
	await page.getByRole("combobox", { name: "What to watch" }).selectOption("command");
	await expect(page.getByTestId("computer-hours-estimate")).toBeVisible();
	await expect(page.getByRole("group", { name: "Allowed actions" })).toBeVisible();
});
test("centers the New routine icon with its label", async ({ page }) => {
	await page.goto("/bots/inbox");
	const button = page.getByRole("button", { name: "New routine", exact: true });
	await expect(button).toBeVisible();
	await page.evaluate(() => document.fonts.ready);
	const buttonBox = await button.boundingBox();
	const iconBox = await button.locator("svg").boundingBox();
	expect(buttonBox).not.toBeNull();
	expect(iconBox).not.toBeNull();
	expect(Math.abs(iconBox!.y + iconBox!.height / 2 - (buttonBox!.y + buttonBox!.height / 2))).toBeLessThanOrEqual(0.5);
	await button.click();
	await expect(page).toHaveURL(/\/bots\/inbox\/routines\/new$/);
});

test("routine names and statuses match the Model configuration typography", async ({ page }) => {
	await page.goto("/bots/reviewer");
	const pane = page.getByRole("complementary", { name: "Conversation details" });
	const modelLabel = pane.locator('[data-ref="settings-group"] .kb-group__row > span').first();
	const routineRows = pane.locator(".kb-group__row--button");
	await expect(modelLabel).toBeVisible();
	await expect(routineRows).toHaveCount(2);
	const typography = await modelLabel.evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			fontFamily: style.fontFamily,
			fontSize: style.fontSize,
			fontWeight: style.fontWeight,
			lineHeight: style.lineHeight,
			letterSpacing: style.letterSpacing,
		};
	});
	for (const row of await routineRows.all()) {
		for (const label of await row.locator("span").all()) {
			for (const [property, value] of Object.entries(typography)) {
				const cssProperty = property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
				await expect(label).toHaveCSS(cssProperty, value);
			}
		}
	}
});

for (const screen of ["routines", "routine-edit", "activity", "usage"])
	test(`${screen} matches the reference`, async ({ page }) => compareToReference(page, screen));
