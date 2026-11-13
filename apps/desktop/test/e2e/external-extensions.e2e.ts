/** S2: real disk artifacts, native consent, shared runtime, revision CSS, reload retention and safe mode. */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect } from "@playwright/test";
import { MOD, openSettings, send, settle, test } from "../parity/harness.ts";

const examples = resolve(__dirname, "../../../../packages/cli/examples/desktop-extensions");

test("external artifacts need native consent and retain the live revision on failed reload", async ({ desktop }) => {
	test.setTimeout(150_000);
	const { page, app, agentDir } = desktop;
	const directory = join(agentDir, "desktop-extensions");
	mkdirSync(directory);
	cpSync(join(examples, "08-owned-css"), join(directory, "styles"), { recursive: true });
	cpSync(join(examples, "06-failure"), join(directory, "failure"), { recursive: true });
	const foreignSource = join(directory, "foreign");
	mkdirSync(foreignSource);
	writeFileSync(
		join(foreignSource, "package.json"),
		JSON.stringify({ knightcode: { desktop: { frontend: "./app.js", styles: ["./app.css"] } } }),
	);
	writeFileSync(
		join(foreignSource, "app.js"),
		'import {createElement} from "react"; import {defineDesktopExtension} from "@knightcodeai/cli/desktop"; export default defineDesktopExtension(app=>{app.experimental_registerSlot({id:"foreign",surface:"feedback",experimental_render:()=>createElement("span",{className:"external-only"},"Foreign contribution")});});',
	);
	const globals =
		'@keyframes pulse {from {opacity:1} to {opacity:1}} @font-face {font-family:Demo;src:local("Arial")} @property --marker {syntax:"<number>";inherits:false;initial-value:1} .external-only {animation:pulse 10s infinite;font-family:Demo;--marker:invalid}';
	writeFileSync(join(foreignSource, "app.css"), `.external-only {color:rgb(130,60,20)} ${globals}`);
	const ownCss = join(directory, "styles", "app.css");
	writeFileSync(ownCss, `${readFileSync(ownCss, "utf8")}\n${globals}`);
	const hostBase = await page
		.locator("body")
		.evaluate((node) => ({ color: getComputedStyle(node).color, font: getComputedStyle(node).fontFamily }));
	await openSettings(page, "Extensions & skills");
	const management = page.getByRole("region", { name: "Native desktop extensions" });
	await expect(management.getByText("Native consent required", { exact: true })).toHaveCount(3);
	await expect(page.getByRole("button", { name: "Owned CSS example", exact: true })).toHaveCount(0);
	await app.evaluate(({ dialog }) => {
		dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
	});
	const styles = management
		.locator("[data-extension]")
		.filter({ has: page.getByRole("heading", { name: "styles", exact: true }) });
	await styles.getByRole("button", { name: "Trust frontend", exact: true }).click();
	const button = page.getByRole("button", { name: "Owned CSS example", exact: true });
	await expect(button).toBeVisible();
	await expect(button).toHaveCSS("color", "rgb(17, 83, 149)");
	const owner = await styles.getAttribute("data-extension");
	const foreign = management
		.locator("[data-extension]")
		.filter({ has: page.getByRole("heading", { name: "foreign", exact: true }) });
	await foreign.getByRole("button", { name: "Trust frontend", exact: true }).click();
	await expect(page.getByText("Foreign contribution", { exact: true })).toHaveCSS("color", "rgb(130, 60, 20)");
	const globalNames = await page.evaluate((owner) => {
		const own = document.querySelector(`[data-kc-owner="${owner}"] .external-only`)!;
		const foreign = [...document.querySelectorAll("span")].find((node) => node.textContent === "Foreign contribution")!;
		return [own, foreign].map((node) => {
			const root = node.closest("[data-kc-owner]")!;
			const prefix = `kc-${root.getAttribute("data-kc-owner")}-${root.getAttribute("data-kc-revision")}-`;
			return {
				prefix,
				animation: getComputedStyle(node).animationName,
				marker: getComputedStyle(node).getPropertyValue(`--${prefix}marker`),
				registeredFont: [...document.fonts].some((face) => face.family === `${prefix}Demo`),
			};
		});
	}, owner);
	for (const names of globalNames) {
		expect(names.animation).toBe(`${names.prefix}pulse`);
		expect(names.marker).toBe("1");
		expect(names.registeredFont).toBe(true);
	}
	expect(globalNames[0]!.prefix).not.toBe(globalNames[1]!.prefix);
	const nested = await page.evaluate((owner) => {
		const parent = document.querySelector(`[data-kc-owner="${owner}"] .external-only`)!;
		const text = [...document.querySelectorAll("span")].find((node) => node.textContent === "Foreign contribution")!;
		const root = text.closest("[data-kc-owner]")!;
		const original = root.parentNode!;
		const next = root.nextSibling;
		parent.append(root);
		const result = { color: getComputedStyle(text).color, weight: getComputedStyle(text).fontWeight };
		original.insertBefore(root, next);
		return result;
	}, owner);
	expect(nested).toEqual({ color: "rgb(130, 60, 20)", weight: "400" });
	expect(
		await page
			.locator("body")
			.evaluate((node) => ({ color: getComputedStyle(node).color, font: getComputedStyle(node).fontFamily })),
	).toEqual(hostBase);
	await foreign.getByRole("button", { name: "Disable", exact: true }).click();
	await button.click();
	const portal = page.getByText("Owned portal follows the theme", { exact: true });
	await expect(portal).toBeVisible();
	await expect(portal.locator("xpath=..").locator("xpath=..")).toHaveAttribute("data-kc-owner", owner!);
	const before = await portal.evaluate((node) => getComputedStyle(node).color);
	await openSettings(page, "Appearance");
	await page.getByRole("radio", { name: "Dark", exact: true }).focus();
	await page.keyboard.press("Space");
	await expect.poll(() => portal.evaluate((node) => getComputedStyle(node).color)).not.toBe(before);
	await page.getByRole("radio", { name: "Light", exact: true }).focus();
	await page.keyboard.press("Space");
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
	await page.getByRole("button", { name: "Close owned portal", exact: true }).click();
	await openSettings(page, "Extensions & skills");
	const source = join(directory, "styles", "app.tsx");
	const good = readFileSync(source, "utf8");
	writeFileSync(source, good.replace("Owned CSS example", "Reloaded CSS example"));
	await management.getByRole("button", { name: "Reload extensions", exact: true }).click();
	await expect(page.getByRole("button", { name: "Reloaded CSS example", exact: true })).toHaveCount(1);
	writeFileSync(source, good.replace("Owned CSS example", "CSS must not publish"));
	// Electron custom protocols bypass page.route; remove a real staged stylesheet to exercise readiness failure.
	const staged = JSON.parse(
		execFileSync(
			"bun",
			[
				resolve(__dirname, "../../../../packages/cli/test/fixtures/desktop-stage.ts"),
				join(directory, "styles"),
				join(agentDir, "desktop-artifacts"),
				owner!,
			],
			{ env: desktop.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
		),
	) as { root: string; styles: string[] };
	rmSync(join(staged.root, staged.styles[0]!));
	await management.getByRole("button", { name: "Reload extensions", exact: true }).click();
	await expect(styles.getByRole("alert")).toContainText("Failed to load extension CSS");
	await expect(page.getByRole("button", { name: "Reloaded CSS example", exact: true })).toHaveCount(1);
	await expect(page.getByRole("button", { name: "CSS must not publish", exact: true })).toHaveCount(0);
	writeFileSync(source, 'throw new Error("Deliberate setup failure"); export default {};');
	await management.getByRole("button", { name: "Reload extensions", exact: true }).click();
	await expect(styles.getByRole("alert")).toContainText("Deliberate setup failure");
	for (const [body, message] of [
		[
			'app.experimental_registerCommand({id:"duplicate",label:()=>"Partial",experimental_run:()=>{}}); app.experimental_registerCommand({id:"duplicate",label:()=>"Partial",experimental_run:()=>{}});',
			"Duplicate registration",
		],
		["", "Unsupported desktop apiVersion"],
		["await Promise.resolve();", "setup must be synchronous"],
	]) {
		const setup = message.includes("synchronous") ? "async (app)" : "(app)";
		const options = message.includes("apiVersion") ? ", {apiVersion:2}" : "";
		writeFileSync(
			source,
			`import {defineDesktopExtension} from "@knightcodeai/cli/desktop"; export default defineDesktopExtension(${setup}=>{${body}}${options});`,
		);
		await management.getByRole("button", { name: "Reload extensions", exact: true }).click();
		await expect(styles.getByRole("alert")).toContainText(message);
		await expect(page.getByRole("button", { name: "Reloaded CSS example", exact: true })).toHaveCount(1);
	}
	await expect(page.getByRole("button", { name: "Reloaded CSS example", exact: true })).toHaveCount(1);
	await expect(page.locator(`link[data-kc-styles^="${owner}/"]`)).toHaveCount(1);
	await styles.getByRole("button", { name: "Disable", exact: true }).click();
	await expect(page.getByRole("button", { name: "Reloaded CSS example", exact: true })).toHaveCount(0);
	await expect(page.locator(`link[data-kc-styles^="${owner}/"]`)).toHaveCount(0);

	const failure = management
		.locator("[data-extension]")
		.filter({ has: page.getByRole("heading", { name: "failure", exact: true }) });
	await failure.getByRole("button", { name: "Trust frontend", exact: true }).click();
	const failureOwner = await failure.getAttribute("data-extension");
	await expect(page.getByRole("alert", { name: "Desktop extension recovery" })).toHaveCount(0);
	await management.getByLabel("Feedback provider", { exact: true }).selectOption(`${failureOwner}/broken`);
	await expect(page.getByRole("alert", { name: "Desktop extension recovery" })).toBeVisible();
	await expect(page.locator('[data-kc-owner="builtin.feedback"]')).toHaveCount(1);
	await page.keyboard.press(`${MOD}+K`);
	await page.getByRole("option", { name: "External test notice", exact: true }).click();
	await expect(page.getByRole("status", { name: "Notifications" })).toContainText("External command reached the host");
	await failure.getByRole("button", { name: "Disable", exact: true }).click();
	await expect(management.getByLabel("Feedback provider", { exact: true })).toHaveValue(`${failureOwner}/broken`);
	await page.getByRole("button", { name: "Switch back", exact: true }).click();
	await expect(page.getByRole("alert", { name: "Desktop extension recovery" })).toHaveCount(0);

	writeFileSync(source, good);
	await styles.getByRole("button", { name: "Enable", exact: true }).click();
	await expect(button).toBeVisible();
	await desktop.relaunch({ safeMode: true });
	await openSettings(desktop.page, "Extensions & skills");
	await expect(desktop.page.getByText(/Safe mode: no external frontend code/)).toBeVisible();
	await expect(desktop.page.locator('script[src^="app://ext/"], link[data-kc-styles]')).toHaveCount(0);
	await expect(desktop.page.getByRole("button", { name: "Owned CSS example", exact: true })).toHaveCount(0);
});

test("two windows have separate mounts and receive frontend reloads", async ({ desktop }) => {
	const { page, app, agentDir } = desktop;
	const directory = join(agentDir, "desktop-extensions", "styles");
	cpSync(join(examples, "08-owned-css"), directory, { recursive: true });
	const providerSource = join(agentDir, "desktop-extensions", "provider");
	mkdirSync(providerSource);
	writeFileSync(
		join(providerSource, "package.json"),
		JSON.stringify({ knightcode: { desktop: { frontend: "./app.js" } } }),
	);
	writeFileSync(
		join(providerSource, "app.js"),
		'import {createElement} from "react"; import {defineDesktopExtension} from "@knightcodeai/cli/desktop"; export default defineDesktopExtension(app=>{app.experimental_registerProvider({id:"view",surface:"feedback",experimental_render:()=>createElement("p",{role:"status"},"Selected external feedback")});});',
	);
	await app.evaluate(({ dialog }) => {
		dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
	});
	await openSettings(page, "Extensions & skills");
	const stylesRow = page
		.locator("[data-extension]")
		.filter({ has: page.getByRole("heading", { name: "styles", exact: true }) });
	const providerRow = page
		.locator("[data-extension]")
		.filter({ has: page.getByRole("heading", { name: "provider", exact: true }) });
	await stylesRow.getByRole("button", { name: "Trust frontend", exact: true }).click();
	await providerRow.getByRole("button", { name: "Trust frontend", exact: true }).click();
	const provider = `${await providerRow.getAttribute("data-extension")}/view`;
	await expect(page.getByText("Selected external feedback", { exact: true })).toHaveCount(0);
	await page.getByRole("button", { name: "Owned CSS example", exact: true }).click();
	await page.keyboard.press(`${MOD}+N`);
	await send(page, "say hello");
	await expect(page.getByText("Hello from the faux model.")).toBeVisible();
	const opened = app.waitForEvent("window");
	await page.getByRole("button", { name: "Chat actions" }).click();
	await page.getByRole("menuitem", { name: "Open in new window", exact: true }).click();
	const second = await opened;
	await settle(app, second, "light", { width: 1280, height: 820 });
	await expect(second.getByRole("button", { name: "Owned CSS example", exact: true })).toBeVisible();
	await expect(second.getByText("Owned portal follows the theme", { exact: true })).toHaveCount(0);
	await expect(page.getByText("Owned portal follows the theme", { exact: true })).toBeVisible();
	await openSettings(page, "Extensions & skills");
	await openSettings(second, "Extensions & skills");
	await page.getByLabel("Feedback provider", { exact: true }).selectOption(provider);
	for (const window of [page, second])
		await expect(window.getByText("Selected external feedback", { exact: true })).toBeVisible();
	await second.getByLabel("Feedback provider for this window", { exact: true }).selectOption("builtin.feedback/toasts");
	await expect(second.getByText("Selected external feedback", { exact: true })).toHaveCount(0);
	await expect(page.getByText("Selected external feedback", { exact: true })).toBeVisible();
	await second.reload();
	await settle(app, second, "light", { width: 1280, height: 820 });
	await openSettings(second, "Extensions & skills");
	await expect(second.getByLabel("Feedback provider for this window", { exact: true })).toHaveValue(
		"builtin.feedback/toasts",
	);
	await expect(second.getByLabel("Feedback provider", { exact: true })).toHaveValue(provider);
	await expect(second.getByText("Selected external feedback", { exact: true })).toHaveCount(0);
	await page.getByLabel("Feedback provider", { exact: true }).selectOption("builtin.feedback/toasts");
	await expect
		.poll(
			() => JSON.parse(readFileSync(join(desktop.userData, "desktop-state.json"), "utf8")).desktopProviders.feedback,
		)
		.toBe("builtin.feedback/toasts");
	const source = join(directory, "app.tsx");
	writeFileSync(source, readFileSync(source, "utf8").replace("Owned CSS example", "Shared revision two"));
	await openSettings(page, "Extensions & skills");
	await page.getByRole("button", { name: "Reload extensions", exact: true }).click();
	for (const window of [page, second])
		await expect(window.getByRole("button", { name: "Shared revision two", exact: true })).toHaveCount(1);
	await second.close();
	await expect(page.getByRole("button", { name: "Shared revision two", exact: true })).toBeVisible();
});

test("owned @scope styles have bounded style-recalculation cost on 500 rows", async ({ desktop }, info) => {
	const measurements = await desktop.page.evaluate(() => {
		const root = document.createElement("aside");
		root.className = "benchmark";
		root.dataset.kcOwner = "benchmark";
		root.dataset.kcRevision = "r";
		root.style.cssText = "position:fixed;left:-10000px;top:0;width:300px";
		root.innerHTML = Array.from({ length: 500 }, (_, index) => `<div class="row">Row ${index}</div>`).join("");
		document.body.append(root);
		const host = document.createElement("style");
		host.textContent =
			".benchmark .row {color:rgb(10,20,30)} .benchmark.alternate .row, .benchmark .row.selected {color:rgb(10,40,50)}";
		document.head.append(host);
		const sheets: HTMLStyleElement[] = [];
		const measure = (mode: "row" | "whole-list") => {
			const times: number[] = [];
			for (let i = 0; i < 40; i++) {
				const start = performance.now();
				if (mode === "row") root.children[i % 500]!.classList.toggle("selected");
				else root.classList.toggle("alternate");
				for (const row of root.children) getComputedStyle(row).color;
				times.push(performance.now() - start);
			}
			return times.sort((a, b) => a - b)[20]!;
		};
		const none = measure("row");
		const noneWholeList = measure("whole-list");
		for (let i = 0; i < 10; i++) {
			const sheet = document.createElement("style");
			sheet.textContent = `@scope ([data-kc-owner="benchmark"][data-kc-revision="r"]) to ([data-kc-owner]:not([data-kc-owner="benchmark"][data-kc-revision="r"])) { :scope .row { color: rgb(${i},20,30); } :scope.alternate .row, :scope .row.selected { color: rgb(${i},40,50); } }`;
			document.head.append(sheet);
			sheets.push(sheet);
		}
		const scoped = measure("row");
		const scopedWholeList = measure("whole-list");
		for (const sheet of sheets) sheet.remove();
		host.remove();
		root.remove();
		return {
			none,
			scoped,
			noneWholeList,
			scopedWholeList,
			rows: 500,
			stylesheets: 10,
			unit: "ms, median of 40 forced reads; row selection and whole-list color invalidation",
		};
	});
	await info.attach("scope-performance", { body: JSON.stringify(measurements), contentType: "application/json" });
	console.log("Scope profile:", measurements);
	expect(measurements.scoped).toBeLessThan(measurements.none + 2);
	expect(measurements.scopedWholeList).toBeLessThan(measurements.noneWholeList + 2);
});
