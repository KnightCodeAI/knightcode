// apps/bots/web/e2e/real-backend.e2e.ts: the whole path against the real Worker (BOTS_BACKEND=real): sign in through
// the GitHub emulator, pick the fake model server's model, create a bot, chat, and find the thread again after a reload.
import { expect, test } from "@playwright/test";
import { REAL } from "./fixtures.ts";

test("sign in with GitHub, create a bot on the fake model server, chat, and keep the thread across a reload", async ({ page, context }) => {
	test.skip(!REAL, "runs against the real backend (BOTS_BACKEND=real)");
	await page.goto("/");
	await page.getByRole("button", { name: "Continue with GitHub" }).click();
	// The emulator's account picker: the seeded GitHub user.
	await page.getByRole("button", { name: /ada-test/ }).click();
	// A new account chooses its handle.
	await expect(page.getByRole("heading", { name: "Choose your handle" })).toBeVisible();
	await page.getByRole("textbox", { name: "Handle" }).fill(`ada-${Date.now().toString(36).slice(-6)}`);
	await page.getByRole("button", { name: "Continue" }).click();
	// The app moves on by itself; a navigation of ours before then would be cut off by it.
	await page.waitForURL((url) => !url.pathname.startsWith("/handle"));
	const account = (await (await context.request.get("/api/account")).json()) as { id: string };
	try {
		// The fake model server is a provider like any other: its model is chosen for new bots.
		await page.goto("/settings/account");
		await page.getByRole("combobox", { name: "Model for new bots" }).click();
		await page.getByRole("option", { name: "fake-model" }).click();

		await page.goto("/new");
		await page.getByRole("textbox", { name: "Bot name" }).fill("Echo");
		await page.getByRole("button", { name: "Create", exact: true }).click();
		// A reply long enough to watch it stream in.
		const reply = `Here is a longer answer, ${Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ")}, and that is all.`;
		await context.request.post(`${process.env.BOTS_FAKE_MODEL_URL!.replace(/\/v1$/, "")}/__script`, { data: { replies: [reply] } });
		const composer = page.getByRole("textbox", { name: "Message" });
		await composer.fill("Hello there, Echo");
		await composer.press("Enter");
		await expect(page.getByTestId("streaming")).toBeVisible();
		await expect(page.getByText("and that is all.", { exact: false })).toBeVisible({ timeout: 20_000 });
		await expect(page.getByTestId("streaming")).toHaveCount(0);

		await page.reload();
		await expect(page.getByText("Hello there, Echo", { exact: true })).toBeVisible();
		await expect(page.getByText("and that is all.", { exact: false })).toBeVisible();
	} finally {
		// Leave nothing behind for the next test, pass or fail: the GitHub user's account goes, so the next sign-in is new.
		await page.close();
		expect((await context.request.post("/__dev/delete", { data: { accountId: account.id }, timeout: 90_000 })).ok()).toBe(true);
	}
});
