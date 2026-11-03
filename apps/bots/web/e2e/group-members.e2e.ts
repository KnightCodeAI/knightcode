// Group details open beside the conversation; membership changes save without a settings dialog.
import { defaultSeed, type FakeSeed } from "@knightcode/bots-protocol";
import { expect, REAL, test } from "./fixtures.ts";

test("group header toggles a pane with Details, Library and Members", async ({ page }) => {
	await page.goto("/groups/launch");
	const pane = page.getByRole("complementary", { name: "Group details" });
	await expect(pane.getByRole("tab", { name: "Details", exact: true })).toHaveAttribute("aria-selected", "true");
	await pane.getByRole("tab", { name: "Library", exact: true }).click();
	await expect(pane.getByRole("tab", { name: "Library", exact: true })).toHaveAttribute("aria-selected", "true");
	await pane.getByRole("button", { name: "Close", exact: true }).click();
	await expect(pane).toBeHidden();
	await page.getByRole("button", { name: "View group details" }).click();
	await expect(pane).toBeVisible();
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await pane.getByRole("tab", { name: "Details", exact: true }).click();
	await expect(pane.getByRole("combobox", { name: "Lead", exact: true })).toBeVisible();
	await expect(pane.getByRole("combobox", { name: "Turns per message", exact: true })).toBeVisible();
	await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("members open bots and can be removed and searched back into the group", async ({ page }) => {
	await page.goto("/groups/launch?pane=members");
	const pane = page.getByRole("complementary", { name: "Group details" });
	await pane.getByRole("button", { name: "Open Reviewer", exact: true }).click();
	await expect(page).toHaveURL(/\/bots\/reviewer/);
	await page.goBack();
	await pane.getByRole("button", { name: "Open Chief of Staff", exact: true }).hover();
	await pane.getByRole("button", { name: "Remove Chief of Staff", exact: true }).click();
	await expect(pane.getByRole("button", { name: "Open Chief of Staff", exact: true })).toHaveCount(0);
	await pane.getByRole("button", { name: "Open Reviewer", exact: true }).hover();
	await expect(pane.getByRole("button", { name: "Remove Reviewer", exact: true })).toBeDisabled();
	await pane.getByRole("button", { name: "Add Member", exact: true }).click();
	const picker = page.getByRole("dialog", { name: "Add member" });
	const search = picker.getByRole("textbox", { name: "Search Bots" });
	await expect(search).toBeFocused();
	await expect(picker.getByRole("button", { name: "Reviewer", exact: true })).toHaveCount(0);
	await search.fill("no matching bot");
	await expect(picker.getByText("No bots found")).toBeVisible();
	await search.fill("cHiEf");
	await picker.getByRole("button", { name: "Chief of Staff", exact: true }).click();
	await expect(picker).toHaveCount(0);
	await expect(pane.getByRole("button", { name: "Open Chief of Staff", exact: true })).toBeVisible();
	await pane.getByRole("tab", { name: "Details", exact: true }).click();
	await expect(pane.getByRole("combobox", { name: "Lead", exact: true })).toHaveText("Reviewer");
});

test("members show an empty add state when all bots have joined", async ({ page }) => {
	await page.goto("/groups/all-hands?pane=members");
	const pane = page.getByRole("complementary", { name: "Group details" });
	await expect(pane.getByText("Create more Bots to add them here")).toBeVisible();
	await expect(pane.getByRole("button", { name: "Add Member", exact: true })).toHaveCount(0);
	await pane.getByRole("button", { name: "Open Reviewer", exact: true }).hover();
	await pane.getByRole("button", { name: "Remove Reviewer", exact: true }).click();
	await pane.getByRole("button", { name: "Add Member", exact: true }).click();
	const picker = page.getByRole("dialog", { name: "Add member" });
	await expect(picker.getByRole("button", { name: "Reviewer", exact: true })).toBeVisible();
	await picker.getByRole("textbox", { name: "Search Bots" }).press("Escape");
	await expect(picker).toHaveCount(0);
});

function withGroupFile(seed: FakeSeed): void {
	const file = { id: "group-note", name: "group-note.txt", size: 10, mime: "text/plain", kind: "attachment" as const, createdAt: 1 };
	seed.files.push(file);
	seed.threads["group:launch"]!.entries.push({ kind: "message", id: "group-file-message", role: "user", text: "Read this note", attachments: [file], createdAt: 1 });
}

test.describe("shared group files", () => {
	test.use({ extendSeed: async ({}, use) => use(withGroupFile) });
	test("group library shows shared attachments without changing the conversation", async ({ page }) => {
		if (!REAL) {
			const seed = defaultSeed();
			withGroupFile(seed);
			await page.route("**/__seed/group-files.json", (route) => route.fulfill({ json: seed }));
		}
		await page.goto(`/groups/launch?pane=library${REAL ? "" : "&seed=group-files"}`);
		const pane = page.getByRole("complementary", { name: "Group details" });
		await expect(pane.getByRole("button", { name: /group-note.txt/ })).toBeVisible();
		await expect(page.getByRole("log").getByText("Read this note")).toBeVisible();
		await pane.getByRole("tab", { name: "Members", exact: true }).click();
		await expect(pane.getByRole("button", { name: "Open Reviewer", exact: true })).toBeVisible();
	});
});

for (const colorScheme of ["light", "dark"] as const) {
	test.describe(`${colorScheme} group pill`, () => {
		test.use({ colorScheme, reducedMotion: "no-preference" });
		test("matches the solo pill hover reveal and suppresses it while the pane is open", async ({ page }) => {
			await page.goto("/groups/launch?pane=closed");
			await page.evaluate(() => document.fonts.ready);
			const pill = page.getByRole("button", { name: "View group details" });
			const chevron = pill.locator(".kb-identity__chevron");
			await expect(chevron).toHaveCSS("opacity", "0");
			const rest = (await pill.boundingBox())!;
			const stack = (await pill.locator(".kb-identity__stack").boundingBox())!;
			const background = await pill.evaluate((element) => getComputedStyle(element).backgroundColor);
			await pill.hover();
			await expect(chevron).toHaveCSS("opacity", "1");
			await expect.poll(async () => (await pill.boundingBox())!.width - rest.width).toBeCloseTo(18, 0);
			const expanded = (await pill.boundingBox())!;
			expect(expanded.x + expanded.width / 2).toBeCloseTo(rest.x + rest.width / 2, 0);
			expect((await pill.locator(".kb-identity__stack").boundingBox())!.width).toBe(stack.width);
			expect(await pill.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(background);
			await page.mouse.move(0, 100);
			await expect(chevron).toHaveCSS("opacity", "0");
			await expect.poll(async () => (await pill.boundingBox())!.width).toBeCloseTo(rest.width, 0);
			await pill.click();
			await expect(pill).toHaveAttribute("aria-expanded", "true");
			await expect(chevron).toHaveCSS("opacity", "0");
		});
	});
}

test("group header avatars have no black outer rings", async ({ page }) => {
	await page.goto("/groups/all-hands");
	const cells = page.locator(".kb-identity__stack-item");
	await expect(cells).toHaveCount(4);
	for (const cell of await cells.all()) {
		const hasOuterShadow = await cell.evaluate((element) =>
			getComputedStyle(element).boxShadow.split(/,(?![^(]*\))/).some((shadow) => shadow.trim() !== "none" && !shadow.includes("inset")),
		);
		expect(hasOuterShadow).toBe(false);
	}
});

test("group pane opens on demand on a phone", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/groups/launch");
	const pane = page.getByRole("complementary", { name: "Group details" });
	await expect(pane).toBeHidden();
	await page.getByRole("button", { name: "View group details" }).click();
	await expect(pane.getByRole("tab", { name: "Members", exact: true })).toBeVisible();
	await pane.getByRole("tab", { name: "Members", exact: true }).click();
	await expect(pane.getByRole("button", { name: "Open Reviewer", exact: true })).toBeVisible();
	await pane.getByRole("button", { name: "Close", exact: true }).click();
	await expect(pane).toBeHidden();
});
