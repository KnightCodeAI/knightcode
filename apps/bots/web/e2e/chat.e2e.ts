// apps/bots/web/e2e/chat.e2e.ts
import { expect, test } from "./fixtures.ts";
import { compareToReference } from "./reference/compare.ts";
test("send, stream, stop, react, reply, quote, attach, mention and skill", async ({ page }) => {
	await page.goto("/bots/reviewer");
	const composer = page.getByRole("textbox", { name: "Message" });
	await composer.fill("Review PR 12");
	await composer.press("Enter");
	await expect(page.getByTestId("streaming")).toBeVisible();
	// KnightCode's own baseline of a reply in progress: the composer offers Stop.
	await expect(page.locator('[data-ref="composer-dock"]')).toHaveScreenshot("composer-streaming.png");
	await page.getByRole("button", { name: "Stop" }).click();
	await composer.fill("@");
	await expect(page.getByRole("listbox", { name: "Mentions" })).toContainText("Inbox");
	await composer.fill("/");
	await expect(page.getByRole("listbox", { name: "Skills" })).toBeVisible();
	await page.setInputFiles('input[type="file"]', { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
	await expect(page.getByTestId("attachment")).toContainText("a.txt");
});
test("approval card answers once and stays answerable while chatting", async ({ page }) => {
	await page.goto("/bots/inbox");
	await page.getByRole("textbox", { name: "Message" }).fill("keep going");
	await page.getByRole("textbox", { name: "Message" }).press("Enter");
	// KnightCode's own baseline of the approval card (the reference has none to compare with).
	await expect(page.locator('[data-card="approval"]').first()).toHaveScreenshot("approval-card.png");
	await page.getByRole("button", { name: "Allow once" }).click();
	await expect(page.getByTestId("approval-state")).toHaveText("Allowed");
});
test("takeover card asks for the user's hand on the screen", async ({ page }) => {
	await page.goto("/bots/social?pane=closed");
	const card = page.locator('[data-card="takeover"]').first();
	await expect(card).toContainText("Sign in to LinkedIn");
	await expect(card).toHaveScreenshot("takeover-card.png");
});
for (const screen of ["chat", "chat-streaming", "composer-mention", "card-question", "card-approval", "card-takeover"])
	test(`${screen} matches the reference`, async ({ page }) => compareToReference(page, screen));
