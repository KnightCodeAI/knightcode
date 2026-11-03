// Inline group creation: recipient chips, search, keyboard selection and generated names.
import { expect, test } from "./fixtures.ts";

test("selects and removes recipients without creating a group", async ({ page }) => {
	await page.goto("/groups/new");
	const picker = page.getByRole("combobox", { name: "Start a chat with", exact: true });
	await expect(picker).toBeFocused();
	await expect(page.getByRole("complementary")).toHaveCount(0);
	await page.getByRole("option", { name: "Reviewer", exact: true }).click();
	await expect(page.getByRole("button", { name: "Remove Reviewer", exact: true })).toBeVisible();
	await expect(page.getByRole("option", { name: "Reviewer", exact: true })).toHaveCount(0);
	await picker.fill("soci");
	await expect(page.getByRole("option")).toHaveCount(1);
	await page.getByRole("option", { name: "Social", exact: true }).click();
	await expect(picker).toHaveValue("");
	await page.getByRole("button", { name: "Remove Reviewer", exact: true }).click();
	await expect(picker).toBeFocused();
	await expect(page.getByRole("option", { name: "Reviewer", exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Remove Social", exact: true })).toBeVisible();
	await expect(page).toHaveURL(/\/groups\/new$/);
});

test("Enter creates a named group from the selected bots in selection order", async ({ page }) => {
	await page.goto("/groups/new");
	for (const name of ["Social", "Reviewer", "Inbox"]) {
		await page.getByRole("option", { name, exact: true }).click();
	}
	await page.getByRole("combobox", { name: "Start a chat with", exact: true }).press("Enter");
	await expect(page.getByRole("button", { name: "View group details" })).toContainText("Social, Reviewer, and Inbox");
	await expect(page.getByRole("link", { name: "Social, Reviewer, and Inbox, group of 3 bots", exact: true })).toBeVisible();
	await expect(page.getByRole("complementary", { name: "Group details" }).getByRole("combobox", { name: "Lead", exact: true })).toHaveText("Social");
	await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeVisible();
});

test("search and arrow keys select bots, then empty Enter creates the group", async ({ page }) => {
	await page.goto("/groups/new");
	const picker = page.getByRole("combobox", { name: "Start a chat with", exact: true });
	await picker.fill("review");
	await picker.press("ArrowDown");
	await picker.press("Enter");
	await expect(page.getByRole("button", { name: "Remove Reviewer", exact: true })).toBeVisible();
	await picker.fill("soci");
	await picker.press("Enter");
	await expect(page.getByRole("button", { name: "Remove Social", exact: true })).toBeVisible();
	await picker.press("Enter");
	await expect(page.getByRole("button", { name: "View group details" })).toContainText("Reviewer and Social");
});

test("does not create with fewer than two members or during composition", async ({ page }) => {
	await page.goto("/groups/new");
	const picker = page.getByRole("combobox", { name: "Start a chat with", exact: true });
	await picker.press("Enter");
	await expect(page).toHaveURL(/\/groups\/new$/);
	await expect(page.getByRole("alert")).toContainText("Choose at least 2 bots");
	await page.getByRole("option", { name: "Reviewer", exact: true }).click();
	await picker.press("Enter");
	await expect(page).toHaveURL(/\/groups\/new$/);
	await page.getByRole("option", { name: "Social", exact: true }).click();
	await picker.dispatchEvent("keydown", { key: "Enter", isComposing: true });
	await expect(page).toHaveURL(/\/groups\/new$/);
	await picker.press("Enter");
	await expect(page.getByRole("button", { name: "View group details" })).toContainText("Reviewer and Social");
});

test("shows no matches and Backspace removes the last chip", async ({ page }) => {
	await page.goto("/groups/new");
	const picker = page.getByRole("combobox", { name: "Start a chat with", exact: true });
	await page.getByRole("option", { name: "Reviewer", exact: true }).click();
	await page.getByRole("option", { name: "Social", exact: true }).click();
	await picker.fill("no such bot");
	await expect(page.getByText("No bots found", { exact: true })).toBeVisible();
	await picker.press("Enter");
	await expect(page).toHaveURL(/\/groups\/new$/);
	await picker.fill("");
	await picker.press("Backspace");
	await expect(page.getByRole("button", { name: "Remove Social", exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Remove Reviewer", exact: true })).toBeVisible();
	await expect(page.getByRole("option", { name: "Social", exact: true })).toBeVisible();
});

test("Escape cancels the inline picker and returns to the chat", async ({ page }) => {
	await page.goto("/bots/reviewer");
	await page.getByRole("button", { name: "Reviewer actions", exact: true }).click();
	await page.getByRole("menuitem", { name: "New group with Reviewer", exact: true }).click();
	await page.getByRole("combobox", { name: "Start a chat with", exact: true }).press("Escape");
	await expect(page).toHaveURL(/\/bots\/reviewer$/);
	await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeVisible();
});
