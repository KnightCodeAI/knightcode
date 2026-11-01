/**
 * The product switcher (KnightCode Bots design, section 15): the sidebar's product name switches the window between
 * the coding app and KnightCode Bots, which runs on the in-memory fake backend until the real one lands.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launch, send, useLaunchedApps } from "./launch.ts";

useLaunchedApps();

test("the sidebar's product name switches to KnightCode Bots and back", async () => {
	const { page, userData } = await launch();
	await send(page, "say hello");
	await expect(page.getByText("Hello from the faux model.")).toBeVisible();
	const coding = page.getByRole("complementary", { name: "Threads" });
	await expect(coding.getByText("say hello")).toBeVisible();

	// "KnightCode ▾", with a badge while a bot needs the user (the fake's Inbox bot does); in Bots the rows show it.
	const switcher = coding.getByRole("button", { name: /^KnightCode/ });
	await expect(switcher.getByText("KnightCode", { exact: true })).toBeVisible();
	await expect(switcher.getByRole("img", { name: /needs? you$/ })).toBeVisible();

	await switcher.click();
	await page.getByRole("menuitemradio", { name: "KnightCode Bots" }).click();
	const bots = page.getByRole("navigation", { name: "Bots" });
	await expect(bots.getByRole("link", { name: "Reviewer, Main Bot" })).toBeVisible();
	await expect(coding).toBeHidden();
	// The whole name fits beside the bots sidebar's buttons.
	const name = bots.getByRole("button", { name: /^KnightCode Bots/ }).getByText("KnightCode Bots", { exact: true });
	expect(await name.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
	// Remembered across launches, in desktop state.
	await expect
		.poll(() => {
			try {
				return JSON.parse(readFileSync(join(userData, "desktop-state.json"), "utf8")).product;
			} catch {
				return undefined; // Not written yet.
			}
		})
		.toBe("bots");

	await bots.getByRole("button", { name: /^KnightCode Bots/ }).click();
	await page.getByRole("menuitemradio", { name: "KnightCode", exact: true }).click();
	await expect(coding.getByText("say hello")).toBeVisible();
	await expect(bots).toBeHidden();
});
