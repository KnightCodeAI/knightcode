/** Real external structural providers, shared row behavior, boot grace and native safe mode. */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect } from "@playwright/test";
import { MOD, openSettings, send, settle, test } from "../parity/harness.ts";

const examples = resolve(__dirname, "../../../../packages/cli/examples/desktop-extensions");

test("structural provider choices preserve thread menus, keyboard navigation, breadcrumbs and recovery", async ({
	desktop,
}) => {
	test.setTimeout(150_000);
	const { page, app, agentDir } = desktop;
	for (const name of ["04-thread-list", "workspace-layout"])
		cpSync(join(examples, name), join(agentDir, "desktop-extensions", name), { recursive: true });
	await app.evaluate(({ dialog }) => {
		dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
	});
	await send(page, "say hello");
	await expect(page.getByText("Hello from the faux model.")).toBeVisible();
	await openSettings(page, "Extensions & skills");
	const listRow = page
		.locator("[data-extension]")
		.filter({ has: page.getByRole("heading", { name: "04-thread-list", exact: true }) });
	const workspaceRow = page
		.locator("[data-extension]")
		.filter({ has: page.getByRole("heading", { name: "workspace-layout", exact: true }) });
	await listRow.getByRole("button", { name: "Trust frontend", exact: true }).click();
	await workspaceRow.getByRole("button", { name: "Trust frontend", exact: true }).click();
	const listOwner = await listRow.getAttribute("data-extension");
	const workspaceOwner = await workspaceRow.getAttribute("data-extension");
	await page.getByLabel("Thread list provider", { exact: true }).selectOption(`${listOwner}/list`);
	await page.keyboard.press(`${MOD}+N`);
	const alternate = page.getByRole("complementary", { name: "Alternate threads" });
	await expect(alternate).toBeVisible();
	const row = alternate.getByRole("button", { name: /^say hello (?:Unpin|Pin) thread Archive thread$/ });
	await row.focus();
	await page.keyboard.press("Enter");
	await expect(page.getByText("Hello from the faux model.")).toBeVisible();
	await row.hover();
	await row.getByRole("button", { name: "Pin thread", exact: true }).click();
	await expect(row.getByRole("button", { name: "Unpin thread", exact: true })).toBeVisible();
	// The shared row sends the same native context menu and runs its selected action.
	await app.evaluate(({ Menu }) => {
		Menu.prototype.popup = function (options) {
			const item = this.items.find((entry) => entry.label === "Rename");
			if (!item) throw new Error("Shared row lost Rename");
			item.click();
			options?.callback?.();
		};
	});
	await row.click({ button: "right" });
	await expect(page.getByRole("dialog", { name: "Rename thread" })).toBeVisible();
	await expect(page.getByRole("dialog", { name: "Rename thread" })).toHaveAttribute("data-kc-owner", listOwner!);
	await page.getByLabel("Thread title").fill("Shared keyboard thread");
	await page.getByRole("button", { name: "Save", exact: true }).click();
	await expect(
		alternate.getByRole("button", { name: /^Shared keyboard thread Unpin thread Archive thread$/ }),
	).toBeVisible();
	await page.getByRole("textbox", { name: "Message", exact: true }).fill("Unsent layout draft");
	await openSettings(page, "Extensions & skills");
	await page.getByLabel("Thread list provider", { exact: true }).selectOption(`${workspaceOwner}/threads`);
	await page.getByLabel("Layout provider", { exact: true }).selectOption(`${workspaceOwner}/layout`);
	// Management bypasses a selected layout, so recovery stays usable.
	await expect(page.getByLabel("Layout provider", { exact: true })).toBeVisible();
	await page.keyboard.press(`${MOD}+N`);
	await expect(page.getByRole("complementary", { name: "Workspace threads" })).toBeVisible();
	await page
		.getByRole("complementary", { name: "Workspace threads" })
		.getByRole("button", { name: /^Shared keyboard thread Unpin thread Archive thread$/ })
		.focus();
	await page.keyboard.press("Enter");
	await expect(page.getByLabel("Workspace breadcrumb", { exact: true })).toContainText("Shared keyboard thread");
	await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("Unsent layout draft");
	await expect(page.getByText("Hello from the faux model.")).toBeVisible();
	await openSettings(page, "Extensions & skills");
	await workspaceRow.getByRole("button", { name: "Disable", exact: true }).click();
	await expect(page.getByRole("alert", { name: "Desktop extension recovery" })).toBeVisible();
	await expect(page.getByLabel("Layout provider", { exact: true })).toHaveValue(`${workspaceOwner}/layout`);
	await page.getByRole("button", { name: "Switch back", exact: true }).click();
	await expect(page.getByLabel("Layout provider", { exact: true })).toHaveValue("builtin.layout/default");
});

test("slow selected chrome gets a bounded skeleton, built-in fallback and clean safe-mode startup", async ({
	desktop,
}) => {
	test.setTimeout(150_000);
	const { page, app, agentDir } = desktop;
	const directory = join(agentDir, "desktop-extensions", "slow-chrome");
	mkdirSync(directory, { recursive: true });
	writeFileSync(
		join(directory, "package.json"),
		JSON.stringify({ type: "module", knightcode: { desktop: { frontend: "./app.js" } } }),
	);
	const source =
		'import {createElement} from "react"; import {defineDesktopExtension} from "@knightcodeai/cli/desktop"; await new Promise(resolve=>setTimeout(resolve,1500)); export default defineDesktopExtension(app=>{app.experimental_hideNavigation({id:"hide-home",target:"home"});app.experimental_registerProvider({id:"rail",surface:"navigation",experimental_render:()=>createElement("nav",{"aria-label":"Alternate rail"},"External navigation")});app.experimental_registerProvider({id:"bad-title",surface:"titleBar",experimental_render:()=>{throw new Error("Deliberate title failure")}});});';
	writeFileSync(join(directory, "app.js"), source);
	await app.evaluate(({ dialog }) => {
		dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
	});
	await openSettings(page, "Extensions & skills");
	const row = page
		.locator("[data-extension]")
		.filter({ has: page.getByRole("heading", { name: "slow-chrome", exact: true }) });
	await row.getByRole("button", { name: "Trust frontend", exact: true }).click();
	const owner = await row.getAttribute("data-extension");
	await expect(
		page.getByLabel("Navigation provider", { exact: true }).locator("option", { hasText: `${owner}/rail` }),
	).toHaveCount(1);
	await page.getByLabel("Navigation provider", { exact: true }).selectOption(`${owner}/rail`);
	await expect(page.getByRole("navigation", { name: "Alternate rail" })).toBeVisible();
	await page.addInitScript(() => {
		const trace: { time: number; skeleton: boolean; builtin: boolean; home: boolean }[] = [];
		Object.assign(window, { __s4BootTrace: trace });
		new MutationObserver(() => {
			const next = {
				time: performance.now(),
				skeleton: !!document.querySelector('[data-kc-skeleton="navigation"]'),
				builtin: !!document.querySelector('[data-kc-owner="builtin.navigation"]'),
				home: !!document.querySelector('button[aria-label="Home"]'),
			};
			const last = trace.at(-1);
			if (!last || next.skeleton !== last.skeleton || next.builtin !== last.builtin || next.home !== last.home)
				trace.push(next);
		}).observe(document, { subtree: true, childList: true });
	});
	await page.reload();
	await settle(app, page, "light", { width: 1280, height: 820 });
	await expect(page.getByRole("navigation", { name: "Alternate rail" })).toBeVisible();
	const trace = await page.evaluate(
		() =>
			(window as unknown as { __s4BootTrace: { time: number; skeleton: boolean; builtin: boolean; home: boolean }[] })
				.__s4BootTrace,
	);
	const skeleton = trace.find((entry) => entry.skeleton);
	const fallback = trace.find((entry) => entry.builtin);
	expect(skeleton).toBeDefined();
	expect(fallback).toBeDefined();
	expect(fallback!.time - skeleton!.time).toBeLessThan(400);
	expect(trace.filter((entry) => entry.home)).toEqual([]);
	await openSettings(page, "Extensions & skills");
	await page.getByLabel("Title bar provider", { exact: true }).selectOption(`${owner}/bad-title`);
	await expect(page.getByRole("menubar", { name: "Application menu" })).toBeVisible();
	await expect(page.getByRole("alert", { name: "Desktop extension recovery" })).toBeVisible();
	await expect(page.getByLabel("Title bar provider", { exact: true })).toHaveValue(`${owner}/bad-title`);
	expect(
		JSON.parse(readFileSync(join(desktop.userData, "desktop-state.json"), "utf8")).desktopProviders.navigation,
	).toBe(`${owner}/rail`);
	await desktop.relaunch({ safeMode: true });
	await expect(desktop.page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
	await expect(desktop.page.locator('[data-kc-skeleton], script[src^="app://ext/"], link[data-kc-styles]')).toHaveCount(
		0,
	);
});

test("home sections and row slots retain ordering/context while hidden pages share navigation history", async ({
	desktop,
}) => {
	test.setTimeout(150_000);
	const { page, app, agentDir } = desktop;
	const directory = join(agentDir, "desktop-extensions", "sections");
	mkdirSync(directory, { recursive: true });
	writeFileSync(
		join(directory, "package.json"),
		JSON.stringify({ type: "module", knightcode: { desktop: { frontend: "./app.js" } } }),
	);
	const source = `import {createElement as h} from "react";
import {defineDesktopExtension, experimental_controllers as controllers} from "@knightcodeai/cli/desktop";
export default defineDesktopExtension(app=>{
 app.experimental_registerSlot({id:"last",surface:"homeSection",order:10,experimental_render:()=>h("span",{"data-home-order":"last"},"Last home section")});
 app.experimental_registerSlot({id:"first",surface:"homeSection",order:-10,experimental_render:()=>h("span",{"data-home-order":"first"},"First home section")});
 app.experimental_registerSlot({id:"metadata",surface:"threadRowMetadata",experimental_render:({context})=>h("span",{"data-row-metadata":context.row.id},"Row metadata")});
 app.experimental_registerSlot({id:"status",surface:"threadRowStatus",experimental_render:({context})=>h("span",{"data-row-status":context.row.id},"Ready")});
 app.experimental_registerSlot({id:"action",surface:"threadRowActions",experimental_render:({context})=>h("button",{"aria-label":"Extension pin action",onClick:()=>controllers().experimental_pinThread(context.row.id,true)},"Pin")});
 app.experimental_registerPage({id:"hidden",label:"Hidden page",hidden:true,experimental_render:()=>h("section",{"aria-label":"Hidden workspace",role:"region"},"Hidden workspace content")});
 app.experimental_registerCommand({id:"open",label:()=>"Open hidden page",experimental_run:()=>{controllers().experimental_openPage(OWNER+"/hidden")}});
 app.experimental_registerProvider({id:"home",surface:"home",experimental_render:()=>h("section",{"aria-label":"Alternate home",role:"region"},"Alternate home content")});
});`;
	// The host assigns the source identity; replace only the command's explicit namespaced page target after discovery.
	writeFileSync(join(directory, "app.js"), source.replace("OWNER", '"pending"'));
	await app.evaluate(({ dialog }) => {
		dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
	});
	await openSettings(page, "Extensions & skills");
	const row = page
		.locator("[data-extension]")
		.filter({ has: page.getByRole("heading", { name: "sections", exact: true }) });
	const owner = await row.getAttribute("data-extension");
	writeFileSync(join(directory, "app.js"), source.replace("OWNER", JSON.stringify(owner)));
	await row.getByRole("button", { name: "Trust frontend", exact: true }).click();
	await expect(page.getByLabel("Home provider", { exact: true })).toHaveValue("builtin.home/default");
	await page.keyboard.press(`${MOD}+N`);
	await expect(page.locator("[data-home-order]")).toHaveText(["First home section", "Last home section"]);
	await expect(page.getByRole("button", { name: "Hidden page", exact: true })).toHaveCount(0);
	await send(page, "say hello");
	await expect(page.getByText("Hello from the faux model.")).toBeVisible();
	const metadata = page.locator("[data-row-metadata]");
	await expect(metadata).toHaveCount(1);
	const id = await metadata.getAttribute("data-row-metadata");
	await expect(page.locator("[data-row-status]")).toHaveAttribute("data-row-status", id!);
	await metadata.locator('xpath=ancestor::*[@role="button"][1]').hover();
	await page.getByRole("button", { name: "Extension pin action", exact: true }).click();
	await expect(page.getByRole("button", { name: "Unpin thread", exact: true }).first()).toBeVisible();
	await openSettings(page, "Extensions & skills");
	await page.getByLabel("Home provider", { exact: true }).selectOption(`${owner}/home`);
	await page.keyboard.press(`${MOD}+N`);
	await expect(page.getByRole("region", { name: "Alternate home" })).toBeVisible();
	await page.keyboard.press(`${MOD}+K`);
	await page.getByRole("option", { name: "Open hidden page", exact: true }).click();
	await expect(page.getByRole("region", { name: "Hidden workspace" })).toBeVisible();
	await page.getByRole("button", { name: "Back", exact: true }).click();
	await expect(page.getByRole("region", { name: "Alternate home" })).toBeVisible();
	await page.getByRole("button", { name: "Forward", exact: true }).click();
	await expect(page.getByRole("region", { name: "Hidden workspace" })).toBeVisible();
	writeFileSync(
		join(directory, "app.js"),
		'import {defineDesktopExtension} from "@knightcodeai/cli/desktop"; export default defineDesktopExtension(()=>{});',
	);
	await expect(page.getByText("This page is unavailable.", { exact: false })).toBeVisible();
	await page.getByRole("button", { name: "Manage extensions", exact: true }).first().click();
	await expect(page.getByRole("region", { name: "Native desktop extensions" })).toBeVisible();
});
