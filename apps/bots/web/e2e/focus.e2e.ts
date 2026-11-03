// Global focus rings are a fallback; menus and text fields provide their own focus feedback.
import { expect, test } from "./fixtures.ts";

for (const colorScheme of ["light", "dark"] as const) {
	test.describe(`${colorScheme} focus styles`, () => {
		test.use({ colorScheme });

		test("account menu uses its highlight instead of a global outline", async ({ page }) => {
			await page.goto("/bots/inbox");
			const trigger = page.getByRole("button", { name: "Open account menu" });
			await trigger.focus();
			await page.keyboard.press("ArrowDown");
			const plan = page.getByRole("menuitem", { name: /% used/ });
			await expect(plan).toBeFocused();
			await expect(plan).toHaveAttribute("data-highlighted", "");
			await expect(plan).toHaveCSS("outline-style", "none");
			await expect
				.poll(() => plan.evaluate((item) => getComputedStyle(item, "::before").backgroundColor))
				.not.toBe("rgba(0, 0, 0, 0)");

			await page.keyboard.press("ArrowDown");
			const mobile = page.getByRole("menuitem", { name: "Get Bots for mobile" });
			await expect(mobile).toBeFocused();
			await expect(mobile).toHaveCSS("outline-style", "none");
			await plan.hover();
			await expect(plan).toBeFocused();
			await expect(plan).toHaveCSS("outline-style", "none");
			await page.keyboard.press("Escape");
			await expect(trigger).toBeFocused();
			await expect(trigger).toHaveCSS("outline-style", "solid");
		});

		test("mouse selection does not leave a focus ring on the account trigger", async ({ page }) => {
			await page.goto("/bots/inbox");
			const trigger = page.getByRole("button", { name: "Open account menu" });
			await trigger.click();
			await page.getByRole("menuitem", { name: "Archived bots", exact: true }).click();
			await expect(page.getByRole("button", { name: /Archived · Back to bots/ })).toBeVisible();
			await expect(trigger).toBeFocused();
			await expect(trigger).toHaveCSS("outline-style", "none");
			await page.keyboard.press("Tab");
			await page.keyboard.press("Shift+Tab");
			await expect(trigger).toBeFocused();
			await expect(trigger).toHaveCSS("outline-style", "solid");
		});

		test("mouse dismissal of a chat menu restores focus without a ring", async ({ page }) => {
			await page.goto("/bots/reviewer?pane=closed");
			const trigger = page.getByRole("button", { name: "Composer actions", exact: true });
			const field = (await page.getByRole("textbox", { name: "Message", exact: true }).boundingBox())!;
			await trigger.click();
			await expect(page.getByRole("menu", { name: "Composer actions", exact: true })).toBeVisible();
			// A modal menu disables pointer events on the underlying controls; dismiss it with a real outside click.
			await page.mouse.click(field.x + field.width / 2, field.y + field.height / 2);
			await expect(page.getByRole("menu", { name: "Composer actions", exact: true })).toHaveCount(0);
			await expect(trigger).toBeFocused();
			await expect(trigger).toHaveCSS("outline-style", "none");
			await page.keyboard.press("Tab");
			const skill = page.getByRole("button", { name: "Run a skill", exact: true });
			await expect(skill).toBeFocused();
			await expect(skill).toHaveCSS("outline-style", "solid");
		});

		test("text fields keep their border feedback without an extra ring", async ({ page }) => {
			await page.goto("/__gallery");
			await page.getByRole("button", { name: "Open dialog" }).click();
			const input = page.getByRole("textbox", { name: "Bot name", exact: true });
			await input.focus();
			await page.keyboard.press("a");
			await expect(input).toBeFocused();
			await expect(input).toHaveCSS("outline-style", "none");
			const border = await input.evaluate((element) => {
				const style = getComputedStyle(element);
				return style.getPropertyValue("--kb-color-border-strong").trim();
			});
			await expect(input).toHaveCSS("border-top-color", border);
		});

		test("ordinary buttons still have a visible keyboard focus ring", async ({ page }) => {
			await page.goto("/bots/inbox");
			const account = page.getByRole("button", { name: "Open account menu" });
			await account.focus();
			await page.keyboard.press("Tab");
			const connect = page.getByRole("button", { name: "Connect apps", exact: true });
			await expect(connect).toBeFocused();
			await expect(connect).toHaveCSS("outline-style", "solid");
			await expect(connect).toHaveCSS("outline-width", "2px");
		});
	});
}
