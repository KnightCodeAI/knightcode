// Group settings live in the Details pane; creation uses an inline recipient picker.
import { expect, test } from "./fixtures.ts";

test("edits the group name, lead and turn budget in Details without opening a dialog", async ({ page }) => {
	await page.goto("/groups/launch");
	const pane = page.getByRole("complementary", { name: "Group details" });
	const name = pane.getByRole("textbox", { name: "Group name", exact: true });
	await name.fill("Release team");
	await name.press("Enter");
	await expect(page.getByRole("button", { name: "View group details" })).toContainText("Release team");
	await expect(page.getByRole("link", { name: "Release team, group of 3 bots", exact: true })).toBeVisible();
	await pane.getByRole("combobox", { name: "Lead", exact: true }).click();
	await expect(page.getByRole("option", { name: "Inbox", exact: true })).toHaveCount(0);
	await page.getByRole("option", { name: "Social", exact: true }).click();
	await expect(pane.getByRole("combobox", { name: "Lead", exact: true })).toHaveText("Social");
	await expect(pane.getByRole("combobox", { name: "Turns per message", exact: true })).toHaveText("12");
	await pane.getByRole("combobox", { name: "Turns per message", exact: true }).click();
	await page.getByRole("option", { name: "6", exact: true }).click();
	await expect(pane.getByRole("combobox", { name: "Turns per message", exact: true })).toHaveText("6");
	await pane.getByRole("tab", { name: "Members", exact: true }).click();
	await pane.getByRole("tab", { name: "Details", exact: true }).click();
	await expect(name).toHaveValue("Release team");
	await expect(pane.getByRole("combobox", { name: "Lead", exact: true })).toHaveText("Social");
	await expect(pane.getByRole("combobox", { name: "Turns per message", exact: true })).toHaveText("6");
	await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("rejects an empty name and cancels a draft name with Escape", async ({ page }) => {
	await page.goto("/groups/launch");
	const name = page.getByRole("textbox", { name: "Group name", exact: true });
	await name.fill("   ");
	await name.press("Enter");
	await expect(name).toHaveValue("Launch");
	await name.fill("Not saved");
	await name.press("Escape");
	await name.press("Tab");
	await expect(name).toHaveValue("Launch");
	await expect(page.getByRole("button", { name: "View group details" })).toContainText("Launch");
});

test("does not offer group deletion in the pane", async ({ page }) => {
	await page.goto("/groups/launch");
	const pane = page.getByRole("complementary", { name: "Group details" });
	await expect(pane.getByRole("combobox", { name: "Lead", exact: true })).toBeVisible();
	await expect(pane.getByRole("button", { name: "Delete group", exact: true })).toHaveCount(0);
	await expect(page.getByRole("link", { name: "Launch, group of 3 bots", exact: true })).toBeVisible();
});

test("opens new-group creation from the command palette", async ({ page }) => {
	await page.goto("/bots/reviewer");
	await page.getByRole("button", { name: "Search", exact: true }).click();
	await page.getByRole("combobox", { name: "Search", exact: true }).fill("New group chat");
	await page.getByRole("option", { name: /New group chat/ }).click();
	await expect(page.getByRole("combobox", { name: "Start a chat with", exact: true })).toBeFocused();
	await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("still creates a group from a bot's menu", async ({ page }) => {
	await page.goto("/bots/reviewer");
	await page.getByRole("button", { name: "Reviewer actions", exact: true }).click();
	await page.getByRole("menuitem", { name: "New group with Reviewer", exact: true }).click();
	const picker = page.getByRole("combobox", { name: "Start a chat with", exact: true });
	await expect(page.getByRole("button", { name: "Remove Reviewer", exact: true })).toBeVisible();
	await page.getByRole("option", { name: "Social", exact: true }).click();
	await expect(picker).toBeFocused();
	await picker.press("Enter");
	await expect(picker).toHaveCount(0);
	await expect(page.getByRole("button", { name: "View group details" })).toContainText("Reviewer and Social");
	const pane = page.getByRole("complementary", { name: "Group details" });
	await expect(pane.getByRole("combobox", { name: "Lead", exact: true })).toHaveText("Reviewer");
});
