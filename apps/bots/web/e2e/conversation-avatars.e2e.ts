// Group avatars include the owner; normal one-to-one chats show only the bot.
import { defaultSeed, type FakeSeed } from "@knightcode/bots-protocol";
import { expect, REAL, test } from "./fixtures.ts";

function avatarWorld(seed: FakeSeed) {
	for (const count of [1, 2, 3, 4, 7]) {
		seed.groups.push({
			...seed.groups[0]!,
			id: `avatars-${count}`,
			name: `Avatar layout ${count}`,
			// A group can have only one drawable member when another bot is archived.
			memberIds: count === 1 ? [seed.bots[0]!.id, "avatars-archived"] : seed.bots.slice(0, count).map((bot) => bot.id),
		});
	}
	seed.bots.push({ ...seed.bots[0]!, id: "avatars-archived", archived: true });
}

test.use({ extendSeed: async ({}, use) => use(avatarWorld) });

test("profile and bots use diagonal, triangle and square layouts without overflowing", async ({ page }) => {
	const seed = defaultSeed();
	avatarWorld(seed);
	await page.route("**/__seed/avatar-layouts.json", (route) => route.fulfill({ json: seed }));
	await page.goto(REAL ? "/groups/avatars-2" : "/groups/avatars-2?seed=avatar-layouts");
	const sidebar = page.getByRole("navigation", { name: "Bots", exact: true });

	for (const count of [1, 2, 3, 4, 7]) {
		const row = sidebar.locator(`a[href="/groups/avatars-${count}"]`);
		const avatar = row.locator(".kb-group-avatar");
		await expect(avatar.locator(".kb-group-avatar__profile")).toHaveText("R");
		await expect(avatar.locator("[data-avatar]")).toHaveCount(Math.min(count, 3));
		await expect(avatar.locator(".kb-group-avatar__more")).toHaveCount(0);

		const box = (await avatar.boundingBox())!;
		const cells = await avatar.locator(".kb-group-avatar__cell").evaluateAll((elements) =>
			elements.map((element) => {
				const { x, y, width, height } = element.getBoundingClientRect();
				return { x, y, width, height };
			}),
		);
		expect(box.width).toBe(36);
		expect(box.height).toBe(36);
		for (const cell of cells) {
			expect(cell.x).toBeGreaterThanOrEqual(box.x);
			expect(cell.y).toBeGreaterThanOrEqual(box.y);
			expect(cell.x + cell.width).toBeLessThanOrEqual(box.x + box.width + 0.1);
			expect(cell.y + cell.height).toBeLessThanOrEqual(box.y + box.height + 0.1);
		}
		const [profile, first, second, third] = cells;
		expect(profile!.y).toBe(box.y);
		if (count === 1) {
			expect(profile!.x).toBe(box.x);
			expect(first!.x).toBeGreaterThan(profile!.x);
			expect(first!.y).toBeGreaterThan(profile!.y);
		} else if (count === 2) {
			expect(profile!.x + profile!.width / 2).toBeCloseTo(box.x + box.width / 2, 1);
			expect(first!.x).toBe(box.x);
			expect(second!.x).toBeGreaterThan(first!.x);
			expect(first!.y).toBeGreaterThan(profile!.y);
			expect(second!.y).toBe(first!.y);
		} else {
			expect(profile!.x).toBe(box.x);
			expect(first!.x).toBeGreaterThan(profile!.x);
			expect(first!.y).toBe(profile!.y);
			expect(second!.x).toBe(profile!.x);
			expect(second!.y).toBeGreaterThan(profile!.y);
			expect(third!.x).toBe(first!.x);
			expect(third!.y).toBe(second!.y);
		}
	}

	for (const count of [1, 2, 3, 4, 7]) {
		await sidebar.locator(`a[href="/groups/avatars-${count}"]`).click();
		const avatar = page.getByRole("complementary", { name: "Group details" }).locator(".kb-group-avatar");
		await expect(avatar.locator(".kb-group-avatar__profile")).toHaveText("R");
		await expect(avatar.locator("[data-avatar]")).toHaveCount(Math.min(count, 3));
		expect((await avatar.boundingBox())!.width).toBe(64);
		await expect(sidebar.locator(`a[href="/groups/avatars-${count}"]`)).toHaveAttribute(
			"aria-label", `Avatar layout ${count}, group of ${count === 1 ? 2 : count} bots`,
		);
	}
	await expect(page.locator("header .kb-group-avatar__more")).toHaveText("+4");
});

test("normal one-to-one chats show only a full-size bot avatar", async ({ page }) => {
	await page.goto("/bots/reviewer");
	const row = page.getByRole("navigation", { name: "Bots", exact: true }).locator('a[href="/bots/reviewer"]');
	await expect(row.locator("[data-avatar]")).toHaveCount(1);
	await expect(row.locator(".kb-group-avatar__profile")).toHaveCount(0);
	expect((await row.locator("[data-avatar]").boundingBox())!.width).toBe(36);
	const header = page.locator("[data-ref=header-avatar]");
	await expect(header.locator("[data-avatar]")).toHaveCount(1);
	await expect(header.locator(".kb-group-avatar__profile")).toHaveCount(0);
});

test("group initials update when the profile name changes", async ({ page }) => {
	await page.goto("/groups/launch");
	const avatars = page.locator(".kb-group-avatar__profile");
	await expect(avatars.first()).toHaveText("R");
	await page.getByRole("button", { name: "Raghav", exact: true }).click();
	const name = page.locator(".kb-account-card__name");
	await name.fill("  Vera  ");
	await name.press("Tab");
	await expect(avatars.first()).toHaveText("V");
	await name.fill("");
	await name.press("Tab");
	await expect(avatars.first()).toHaveText("R");
});
