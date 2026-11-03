// The group pill shows a compact member cluster and name at rest, without a separate bot count.
import { expect, test } from "./fixtures.ts";

for (const colorScheme of ["light", "dark"] as const) {
	test.describe(`${colorScheme} group pill layout`, () => {
		test.use({ colorScheme });

		test("shows the member cluster beside the name without a bot count or hover", async ({ page }) => {
			await page.goto("/groups/all-hands?pane=closed");
			await page.mouse.move(0, 100);
			const pill = page.getByRole("button", { name: "View group details" });
			await expect(pill.getByText(/\d+ bots/)).toHaveCount(0);
			await expect(pill.locator(".kb-identity__name")).toHaveText("All Hands");
			await expect(pill.locator(".kb-identity__chevron")).toHaveCSS("opacity", "0");
			await expect(pill).toHaveCSS("height", "44px");
			await expect(pill.locator(".kb-identity__name")).toHaveCSS("font-size", "16px");
			const surface = await pill.evaluate((element) =>
				getComputedStyle(element).getPropertyValue("--kb-color-surface").trim(),
			);
			await expect(pill).toHaveCSS("background-color", surface);

			const cluster = pill.locator("[data-avatar-box]");
			const box = (await cluster.boundingBox())!;
			expect(box.width).toBe(28);
			expect(box.height).toBe(28);
			const avatars = cluster.locator("[data-avatar]");
			await expect(avatars).toHaveCount(3);
			const first = (await avatars.nth(0).boundingBox())!;
			const second = (await avatars.nth(1).boundingBox())!;
			const third = (await avatars.nth(2).boundingBox())!;
			const overflow = (await cluster.getByText("+4", { exact: true }).locator("..").boundingBox())!;
			expect(first.width).toBe(14);
			expect(second.y).toBe(first.y);
			expect(second.x).toBeGreaterThan(first.x);
			expect(third.x).toBe(first.x);
			expect(third.y).toBeGreaterThan(first.y);
			expect(overflow.y).toBeGreaterThanOrEqual(third.y);
			expect(overflow.y).toBeLessThan(third.y + 2);
			expect(overflow.x).toBeGreaterThan(third.x);
		});

		test("keeps three members in a compact triangle when details are open", async ({ page }) => {
			await page.goto("/groups/launch?pane=details");
			const pill = page.getByRole("button", { name: "View group details" });
			await expect(pill.getByText(/\d+ bots/)).toHaveCount(0);
			const avatars = pill.locator("[data-avatar-box] [data-avatar]");
			await expect(avatars).toHaveCount(3);
			const top = (await avatars.nth(0).boundingBox())!;
			const left = (await avatars.nth(1).boundingBox())!;
			const right = (await avatars.nth(2).boundingBox())!;
			expect(top.x).toBeGreaterThan(left.x);
			expect(top.x).toBeLessThan(right.x);
			expect(top.y).toBeLessThan(left.y);
			expect(right.y).toBe(left.y);
			await pill.click();
			await expect(pill).toHaveAttribute("aria-expanded", "false");
			await expect(page.getByRole("complementary", { name: "Group details" })).toBeHidden();
		});
	});
}
