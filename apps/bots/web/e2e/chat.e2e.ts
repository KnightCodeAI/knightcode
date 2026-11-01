// apps/bots/web/e2e/chat.e2e.ts
import { expect, test } from "@playwright/test";
import { compareToReference } from "./reference/compare.ts";
test("send, stream, stop, react, reply, quote, attach, mention and skill", async ({ page }) => {
	await page.goto("/bots/reviewer");
	const composer = page.getByRole("textbox", { name: "Message" });
	await composer.fill("Review PR 12");
	await composer.press("Enter");
	await expect(page.getByTestId("streaming")).toBeVisible();
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
	await page.getByRole("button", { name: "Allow once" }).click();
	await expect(page.getByTestId("approval-state")).toHaveText("Allowed");
});
for (const screen of ["chat", "chat-streaming", "composer-mention", "card-question", "card-approval", "card-takeover"])
	test(`${screen} matches the reference`, async ({ page }) => compareToReference(page, screen));
