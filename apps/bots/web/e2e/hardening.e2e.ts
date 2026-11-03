// Behaviours the Part 1 review found missing or broken, each driven the way a person would hit it.
import { expect, test } from "./fixtures.ts";

test("a bot's computer access can be turned off, with the warning about connector blocks", async ({ page }) => {
	await page.goto("/bots/reviewer/settings?edit=1");
	const access = page.getByRole("switch", { name: "Computer access" });
	await expect(access).toBeChecked();
	await expect(page.getByText(/can do in its browser or shell what a connector's Blocked rules stop/)).toBeVisible();
	await access.click();
	await expect(access).not.toBeChecked();
	// Closed and opened again (the fake backend lives in the page, so no reload), the setting has stuck.
	await page.keyboard.press("Escape");
	await expect(access).toHaveCount(0);
	await page.getByRole("navigation", { name: "Bots" }).getByRole("link", { name: /^Reviewer/ }).hover();
	await page.getByRole("button", { name: "Reviewer actions" }).click();
	await page.getByRole("menuitem", { name: /settings/i }).click();
	await expect(page.getByRole("switch", { name: "Computer access" })).not.toBeChecked();
});

test("a draft, its reply and its files stay with their conversation", async ({ page }) => {
	await page.goto("/bots/reviewer");
	const box = page.getByRole("textbox", { name: "Message" });
	await box.fill("only for the reviewer");
	await page.getByRole("navigation", { name: "Bots" }).getByRole("link", { name: "Inbox", exact: true }).click();
	await expect(page).toHaveURL(/\/bots\/inbox$/);
	await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue("");
});

test("an archived bot stays findable after the list reloads", async ({ page }) => {
	await page.goto("/bots/inbox");
	const nav = page.getByRole("navigation", { name: "Bots" });
	await nav.getByRole("link", { name: "Social" }).hover();
	await nav.getByRole("button", { name: "Social actions" }).click();
	await page.getByRole("menuitem", { name: "Archive" }).click();
	await expect(nav.getByRole("link", { name: "Social" })).toHaveCount(0);
	// Anything that reloads the list: duplicating another bot does.
	await nav.getByRole("link", { name: "Inbox", exact: true }).hover();
	await nav.getByRole("button", { name: "Inbox actions" }).click();
	await page.getByRole("menuitem", { name: "Duplicate" }).click();
	await page.getByRole("button", { name: "Open account menu" }).click();
	await page.getByRole("menuitem", { name: "Archived bots" }).click();
	await expect(nav.getByRole("link", { name: "Social" })).toHaveCount(1);
});

test("closing Teach a task mid-recording stops it and hands control back", async ({ page }) => {
	await page.goto("/bots/reviewer/computer?teach=1");
	await page.getByRole("button", { name: "Start recording" }).click();
	await expect(page.getByText("You have control")).toBeVisible();
	await page.getByRole("region", { name: "Teach a task" }).getByRole("button", { name: "Close" }).click();
	await expect(page.getByText("You have control")).toHaveCount(0);
});

test.describe("with the reference world", () => {
	test.use({ seedName: "reference" });
	test("a link to an entry opens the chat at that entry", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 420 });
	await page.goto("/bots/finley?seed=reference&pane=closed");
	const first = page.locator("[data-entry]").first();
	await expect(first).toBeAttached();
	const id = await first.getAttribute("data-entry");
	await expect(first).not.toBeInViewport();
	await page.goto(`/bots/finley?seed=reference&pane=closed&entry=${id}`);
	const target = page.locator(`[data-entry="${id}"]`).first();
	await expect(target).toBeInViewport();
	await expect(target).toHaveAttribute("data-highlighted", "");
	});
});

test("Log out ends the session on the server and leaves the app", async ({ page }) => {
	await page.goto("/bots/reviewer");
	const signOut = page.waitForRequest((request) => request.url().endsWith("/auth/sign-out") && request.method() === "POST");
	await page.getByRole("button", { name: "Open account menu" }).click();
	await page.getByRole("menuitem", { name: "Log out" }).click();
	await signOut;
	await expect(page).toHaveURL(/\/$/);
});
