/** Native recovery must remain usable when a real external frontend wedges its renderer. */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { createDesktopFixture } from "../fixtures/desktop.ts";
import { MOD } from "../parity/harness.ts";

const desktop = resolve(__dirname, "../..");
const faux = resolve(desktop, "../../packages/cli/test/fixtures/faux-app-server.ts");

test("the native safe-mode action escapes a wedged external frontend", async () => {
	const fixture = createDesktopFixture({ theme: "light" });
	const application = await electron.launch({
		args: [desktop, `--user-data-dir=${fixture.userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
		env: { ...fixture.env, KNIGHTCODE_DESKTOP_SERVER: `bun ${faux}` },
	});
	const child = application.process();
	let output = "";
	child.stdout?.on("data", (data) => {
		output += String(data);
	});
	const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
	let deadline: ReturnType<typeof setTimeout> | undefined;
	try {
		const page = await application.firstWindow();
		await expect(page.getByText("Faux E2E").first()).toBeVisible();
		const source = join(fixture.agentDir, "desktop-extensions", "wedged");
		mkdirSync(source, { recursive: true });
		writeFileSync(join(source, "package.json"), JSON.stringify({ knightcode: { desktop: { frontend: "./app.js" } } }));
		writeFileSync(
			join(source, "app.js"),
			'import {defineDesktopExtension} from "@knightcodeai/cli/desktop"; export default defineDesktopExtension(()=>{console.log("KC_FRONTEND_WEDGED"); while(true) {}});',
		);
		await application.evaluate(({ app, dialog }) => {
			dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
			// Record the native relaunch without starting a second, unmanaged Electron process.
			app.relaunch = (options) => {
				console.log(`KC_SAFE_RELAUNCH:${JSON.stringify(options)}`);
			};
		});
		await page.keyboard.press(`${MOD}+Comma`);
		await page.getByRole("button", { name: "Extensions & skills", exact: true }).click();
		const wedged = page.waitForEvent("console", { predicate: (message) => message.text() === "KC_FRONTEND_WEDGED" });
		void page
			.getByRole("button", { name: "Trust frontend", exact: true })
			.click()
			.catch(() => {});
		await wedged;
		await application.evaluate(({ Menu }) => {
			const view = Menu.getApplicationMenu()?.items.find((item) => item.label === "View");
			const recovery = view?.submenu?.items.find((item) => item.label === "Restart without extensions");
			if (!recovery) throw new Error("Native recovery menu is missing");
			recovery.click();
		});
		expect(
			await Promise.race([
				exited,
				new Promise<never>((_resolve, reject) => {
					deadline = setTimeout(() => reject(new Error("Native recovery waited for a wedged renderer")), 15_000);
				}),
			]),
		).toBe(0);
		expect(output).toContain("KC_SAFE_RELAUNCH:");
		expect(output).toContain("--safe-mode");
	} finally {
		clearTimeout(deadline);
		if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
		await exited;
		rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});
