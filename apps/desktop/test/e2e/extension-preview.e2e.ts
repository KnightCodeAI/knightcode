/** D5: the "Run native desktop extensions" preview switch gates external frontend and backend code end to end. */
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect } from "@playwright/test";
import { openSettings, test } from "../parity/harness.ts";

const examples = resolve(__dirname, "../../../../packages/cli/examples/desktop-extensions");

// The product default: the switch is off until the user turns it on.
test.use({ nativeExtensions: false });

test("with the preview off no approved frontend or backend runs; turning it on and off switches both live", async ({
	desktop,
}) => {
	test.setTimeout(150_000);
	const { page, app, agentDir, root } = desktop;
	const source = join(agentDir, "desktop-extensions", "02-backend");
	cpSync(join(examples, "02-backend"), source, { recursive: true });
	// The backend writes a marker each time a service starts, so "no backend code ran" is observable on disk.
	const started = join(root, "backend-started");
	const server = join(source, "server.ts");
	writeFileSync(
		server,
		readFileSync(server, "utf8")
			.replace(
				'import { Type } from "typebox";',
				'import { Type } from "typebox";\nimport { appendFileSync } from "node:fs";',
			)
			.replace(
				"app.experimental_onActivate((context) => {",
				`app.experimental_onActivate((context) => {\n\t\tappendFileSync(${JSON.stringify(started)}, "start\\n");`,
			),
	);
	// Every native confirmation answers its first button (Trust this revision, Turn on) and is counted.
	await app.evaluate(({ dialog }) => {
		const state = globalThis as { __asked?: string[] };
		state.__asked = [];
		dialog.showMessageBox = async (...args: unknown[]) => {
			state.__asked!.push((args.at(-1) as { title?: string }).title ?? "");
			return { response: 0, checkboxChecked: false };
		};
	});
	const asked = () => app.evaluate(() => (globalThis as { __asked?: string[] }).__asked ?? []);

	await openSettings(page, "Extensions & skills");
	const management = page.getByRole("region", { name: "Native desktop extensions" });
	const toggle = management.getByRole("switch", { name: "Run native desktop extensions", exact: true });
	await expect(toggle).not.toBeChecked();
	await expect(
		management.getByText("Off: no extension frontend or backend code runs, even if approved."),
	).toBeVisible();
	const row = management
		.locator("[data-extension]")
		.filter({ has: page.getByRole("heading", { name: "02-backend", exact: true }) });
	// Approval is still possible while off; it records consent but runs nothing.
	await row.getByRole("button", { name: "Trust native code", exact: true }).click();
	await expect(row.getByText(/^Enabled/)).toBeVisible();
	await expect(page.getByRole("button", { name: "Backend counter", exact: true })).toHaveCount(0);
	await expect(page.locator('script[src^="app://ext/"]')).toHaveCount(0);
	expect(existsSync(started)).toBe(false);
	await management.getByRole("button", { name: "Reload extensions", exact: true }).click();
	await page.waitForTimeout(1_000);
	await expect(page.locator('script[src^="app://ext/"]')).toHaveCount(0);
	expect(existsSync(started)).toBe(false);

	// Turning it on asks natively, then runs the approved pair once.
	await toggle.click();
	await expect(toggle).toBeChecked();
	expect(await asked()).toEqual(["Trust native desktop code?", "Turn on native desktop extensions?"]);
	await expect(page.getByRole("button", { name: "Backend counter", exact: true })).toBeVisible();
	await expect.poll(() => (existsSync(started) ? readFileSync(started, "utf8") : "")).toBe("start\n");

	// Off again: the page, module and backend go away without a restart, and the choice persists.
	await openSettings(page, "Extensions & skills");
	await toggle.click();
	await expect(toggle).not.toBeChecked();
	expect(await asked()).toHaveLength(2);
	await expect(page.getByRole("button", { name: "Backend counter", exact: true })).toHaveCount(0);
	await expect(page.locator('link[data-kc-styles], [data-kc-owner^="external-"]')).toHaveCount(0);
	expect(JSON.parse(readFileSync(join(agentDir, "desktop-extension-preview.json"), "utf8"))).toEqual({
		enabled: false,
	});
	await desktop.relaunch();
	await expect(desktop.page.getByRole("button", { name: "Backend counter", exact: true })).toHaveCount(0);
	await expect(desktop.page.locator('script[src^="app://ext/"]')).toHaveCount(0);
	expect(readFileSync(started, "utf8")).toBe("start\n");
});
