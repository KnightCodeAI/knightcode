/** Every remaining persisted settings value: desktop preferences and settings.json written through the UI, then relaunched. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { capture, MOD, openSettings, test } from "./harness.ts";

async function choose(page: Page, label: string, option: string | RegExp): Promise<void> {
	await page.getByRole("button", { name: label, exact: true }).click();
	await page.getByRole("menuitemradio", { name: option, exact: typeof option === "string" }).click();
	await expect(page.getByRole("menu")).toHaveCount(0);
}

test("remaining persisted settings survive a restart", async ({ desktop }) => {
	const read = (file: string) => JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
	const preferences = () => read(join(desktop.userData, "desktop-state.json")).preferences as Record<string, unknown>;
	const settings = () => read(join(desktop.agentDir, "settings.json"));
	let page = desktop.page;

	await openSettings(page, "General");
	await page.getByRole("switch", { name: "Show Full access in the composer" }).click();
	await choose(page, "Confirm before closing a window", "Always");
	await choose(page, "Automatically archive inactive threads", "30 days");
	await page.getByRole("switch", { name: "Show context window usage in the composer" }).click();
	await page.getByRole("group", { name: "Follow-up behavior" }).getByRole("button", { name: "Steer" }).click();
	await choose(page, "Turn completion notifications", "Never");
	await expect.poll(preferences).toMatchObject({
		allowFullAccess: false,
		confirmClose: "always",
		autoArchiveDays: 30,
		showContextUsage: false,
		whileRunning: "steer",
		turnNotifications: "never",
	});

	await openSettings(page, "Appearance");
	const theme = await page.locator("html").getAttribute("data-theme");
	const name = theme === "dark" ? "Dark" : "Light";
	await choose(page, `${name} accent color`, "Blue");
	await page.getByText("Advanced", { exact: true }).click();
	await page.getByLabel("Code font size").fill("13");
	await page.getByLabel("Code font size").press("Enter");
	await page.getByRole("group", { name: "Diff markers" }).getByRole("button", { name: "+/−" }).click();
	await page.getByRole("switch", { name: "Use pointer cursors" }).click();
	await expect.poll(preferences).toMatchObject({
		codeFontSize: 13,
		diffMarkers: "plusMinus",
		pointerCursors: true,
		appearance: { [theme!]: { accent: "#3566f0" } },
	});

	await openSettings(page, "Keyboard shortcuts");
	await page.getByRole("textbox", { name: "Search keyboard shortcuts" }).fill("Go back");
	await page.getByRole("button", { name: "Clear shortcut for Go back" }).last().click();
	await page.getByRole("button", { name: "Change shortcut for Go back" }).first().click();
	await page.keyboard.press(`${MOD}+Alt+B`);
	await expect
		.poll(() => (preferences().keybindings as Record<string, string[]>)?.["desktop.nav.back"])
		.toEqual(["mod+alt+b"]);

	await openSettings(page, "Configuration");
	await page.getByRole("switch", { name: "Skill commands" }).click();
	await choose(page, "Steering", "All at once");
	await choose(page, "HTTP idle timeout", "2 minutes");
	await expect
		.poll(settings)
		.toMatchObject({ enableSkillCommands: expect.any(Boolean), steeringMode: "all", httpIdleTimeoutMs: 120_000 });

	await openSettings(page, "Tools");
	const scratchpad = page.getByRole("switch", { name: "Enable Scratchpad" });
	const before = await scratchpad.isChecked();
	await scratchpad.click();
	await expect(scratchpad).toBeChecked({ checked: !before });
	await expect
		.poll(() => (read(join(desktop.agentDir, "tools.json")).scratchpad as { enabled?: boolean } | undefined)?.enabled)
		.toBe(!before);

	await openSettings(page, "Worktrees");
	await page.getByRole("switch", { name: "Always fetch upstream before creating worktrees" }).click();
	await page.getByRole("switch", { name: "Automatically delete old worktrees" }).click();
	await page.getByRole("spinbutton", { name: "Auto-delete limit" }).fill("7");
	await page.getByRole("spinbutton", { name: "Auto-delete limit" }).press("Tab");
	await expect.poll(() => settings().worktrees).toMatchObject({ fetchBeforeCreate: true, autoDelete: false, keep: 7 });

	await desktop.relaunch();
	page = desktop.page;
	expect(preferences()).toMatchObject({ allowFullAccess: false, whileRunning: "steer", codeFontSize: 13 });
	for (const [label, screen, lowest] of [
		["General", "settings-values-general", "Turn completion notifications"],
		["Appearance", "settings-values-appearance", "Use pointer cursors"],
		["Keyboard shortcuts", "settings-values-shortcuts", undefined],
		["Configuration", "settings-values-configuration", "HTTP idle timeout"],
		["Tools", "settings-values-tools", undefined],
		["Worktrees", "settings-values-worktrees", undefined],
	] as const) {
		await openSettings(page, label);
		if (label === "Appearance") await page.getByText("Advanced", { exact: true }).click();
		if (label === "Keyboard shortcuts")
			await page.getByRole("textbox", { name: "Search keyboard shortcuts" }).fill("Go back");
		if (label === "Configuration")
			await expect(page.getByRole("button", { name: "Steering", exact: true })).toHaveText(/All at once/);
		if (label === "Worktrees")
			await expect(page.getByRole("spinbutton", { name: "Auto-delete limit" })).toHaveValue("7");
		await capture(desktop, screen);
		// Values below the first screen are part of the persisted state too; capture them at their lowest row.
		if (lowest) {
			await page.getByText(lowest, { exact: true }).first().scrollIntoViewIfNeeded();
			await capture(desktop, `${screen}-lower`);
		}
	}
	expect(settings()).toMatchObject({
		steeringMode: "all",
		httpIdleTimeoutMs: 120_000,
		worktrees: { fetchBeforeCreate: true, autoDelete: false, keep: 7 },
	});
});
