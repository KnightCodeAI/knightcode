/** S9 spec 11 gaps: serving containment, CSP and unsupported imports, and provider choice across install/reload. */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect } from "@playwright/test";
import { openSettings, test } from "../parity/harness.ts";

const examples = resolve(__dirname, "../../../../packages/cli/examples/desktop-extensions");

test("staged assets refuse traversal, other owners and revisions; CSP blocks remote and inline code; bad imports never run", async ({
	desktop,
}) => {
	test.setTimeout(150_000);
	const { page, app, agentDir } = desktop;
	const directory = join(agentDir, "desktop-extensions");
	cpSync(join(examples, "08-owned-css"), join(directory, "styles"), { recursive: true });
	// A real harmless backend must stage successfully before the privacy assertion is meaningful.
	cpSync(join(examples, "10-settings", "server.ts"), join(directory, "styles", "server.ts"));
	const manifest = join(directory, "styles", "package.json");
	const pkg = JSON.parse(readFileSync(manifest, "utf8")) as { knightcode: { desktop: { backend?: string } } };
	pkg.knightcode.desktop.backend = "./server.ts";
	writeFileSync(manifest, JSON.stringify(pkg));
	const remote = join(directory, "remote");
	mkdirSync(remote);
	writeFileSync(join(remote, "package.json"), JSON.stringify({ knightcode: { desktop: { frontend: "./app.js" } } }));
	writeFileSync(
		join(remote, "app.js"),
		'import x from "https://example.invalid/x.js"; globalThis.__remoteRan = true; export default x;',
	);
	await app.evaluate(({ dialog }) => {
		dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
	});
	await openSettings(page, "Extensions & skills");
	const management = page.getByRole("region", { name: "Native desktop extensions" });
	const row = (name: string) =>
		management.locator("[data-extension]").filter({ has: page.getByRole("heading", { name, exact: true }) });
	// An unsupported import fails staging when approval reviews it: consent is refused and nothing evaluates.
	await row("remote").getByRole("button", { name: "Trust frontend", exact: true }).click();
	await expect(page.getByRole("status", { name: "Notifications" })).toContainText(
		'Unsupported import "https://example.invalid/x.js"',
	);
	await expect(row("remote").getByText("Native consent required", { exact: true })).toBeVisible();
	expect(await page.evaluate(() => "__remoteRan" in globalThis)).toBe(false);
	await row("styles").getByRole("button", { name: "Trust native code", exact: true }).click();
	await expect(page.getByRole("button", { name: "Owned CSS example", exact: true })).toBeVisible();
	const owner = (await row("styles").getAttribute("data-extension"))!;
	const script = await page.locator(`script[src^="app://ext/${owner}/"]`).first().getAttribute("src");
	const base = new URL(script!);
	const revision = base.pathname.split("/")[2]!;
	expect(existsSync(join(agentDir, "desktop-artifacts", owner, revision, "__backend", "server.ts"))).toBe(true);
	const statuses = await page.evaluate(
		async ({ owner, revision, script }) => {
			const fetchStatus = (url: string) =>
				fetch(url).then(
					(response) => response.status,
					() => -1,
				);
			return {
				// The loaded script, with its activation lease, is served; the same file without one is not.
				served: await fetchStatus(script),
				noActivation: await fetchStatus(`app://ext/${owner}/${revision}/__entry.js`),
				traversal: await fetchStatus(`app://ext/${owner}/${revision}/%2e%2e%2f%2e%2e%2fdesktop-extension-consent.json`),
				encodedSlash: await fetchStatus(`app://ext/${owner}/${revision}/..%2Fpackage.json`),
				undeclared: await fetchStatus(`app://ext/${owner}/${revision}/package.json`),
				otherRevision: await fetchStatus(`app://ext/${owner}/${"0".repeat(64)}/__entry.js`),
				otherOwner: await fetchStatus(`app://ext/external-${"0".repeat(24)}/${revision}/__entry.js`),
				backendPrivate: await fetchStatus(`app://ext/${owner}/${revision}/__backend/server.ts`),
			};
		},
		{ owner, revision, script: script! },
	);
	expect(statuses.served).toBe(200);
	for (const [name, status] of Object.entries(statuses))
		if (name !== "served") expect(status, name).toBeGreaterThanOrEqual(400);
	// The renderer CSP admits only app:// and app://ext scripts: remote modules and inline code are refused.
	const blocked = await page.evaluate(async () => {
		const violations: string[] = [];
		document.addEventListener("securitypolicyviolation", (event) => violations.push(event.blockedURI));
		const remote = document.createElement("script");
		remote.type = "module";
		remote.src = "https://example.invalid/remote.js";
		const inline = document.createElement("script");
		inline.textContent = "globalThis.__inlineRan = true;";
		document.head.append(remote, inline);
		await new Promise((resolve) => setTimeout(resolve, 500));
		remote.remove();
		inline.remove();
		return { violations, inlineRan: "__inlineRan" in globalThis, remoteRan: "__remoteRan" in globalThis };
	});
	expect(blocked.inlineRan).toBe(false);
	expect(blocked.remoteRan).toBe(false);
	expect(blocked.violations).toEqual(expect.arrayContaining(["https://example.invalid/remote.js", "inline"]));
	// Disabling releases the serving lease: the same file is no longer served.
	await row("styles").getByRole("button", { name: "Disable", exact: true }).click();
	await expect(page.getByRole("button", { name: "Owned CSS example", exact: true })).toHaveCount(0);
	expect(
		await page.evaluate(
			(url) =>
				fetch(url).then(
					(r) => r.status,
					() => -1,
				),
			script!,
		),
	).not.toBe(200);
});

test("installing and reloading external providers never changes the selected provider; only explicit choice does", async ({
	desktop,
}) => {
	test.setTimeout(150_000);
	const { page, app, agentDir, userData } = desktop;
	const directory = join(agentDir, "desktop-extensions");
	const provider = (name: string, text: string) => {
		const source = join(directory, name);
		mkdirSync(source, { recursive: true });
		writeFileSync(join(source, "package.json"), JSON.stringify({ knightcode: { desktop: { frontend: "./app.js" } } }));
		writeFileSync(join(source, "label.js"), `export default ${JSON.stringify(text)};\n`);
		writeFileSync(
			join(source, "app.js"),
			`import {createElement} from "react";
import {defineDesktopExtension} from "@knightcodeai/cli/desktop";
import label from "./label.js";
export default defineDesktopExtension(app => {
 app.experimental_registerProvider({id:"view",surface:"feedback",experimental_render:()=>createElement("p",{role:"status"},label)});
});`,
		);
	};
	// Two owners whose discovery order differs from approval order.
	provider("zz-first", "Provider Z");
	provider("aa-second", "Provider A");
	await app.evaluate(({ dialog }) => {
		dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
	});
	await openSettings(page, "Extensions & skills");
	const management = page.getByRole("region", { name: "Native desktop extensions" });
	const row = (name: string) =>
		management.locator("[data-extension]").filter({ has: page.getByRole("heading", { name, exact: true }) });
	const feedback = management.getByLabel("Feedback provider", { exact: true });
	const saved = () => JSON.parse(readFileSync(join(userData, "desktop-state.json"), "utf8")).desktopProviders?.feedback;
	for (const name of ["zz-first", "aa-second"]) {
		await row(name).getByRole("button", { name: "Trust frontend", exact: true }).click();
		await expect(
			feedback.locator("option", { hasText: `${await row(name).getAttribute("data-extension")}/view` }),
		).toHaveCount(1);
		await expect(feedback).toHaveValue("builtin.feedback/toasts");
	}
	await management.getByRole("button", { name: "Reload extensions", exact: true }).click();
	await page.reload();
	await openSettings(page, "Extensions & skills");
	await expect(feedback).toHaveValue("builtin.feedback/toasts");
	await expect(page.getByText(/^Provider [AZ]$/)).toHaveCount(0);
	expect(saved()).toBeUndefined();
	// Only the explicit choice changes it; reload and a source edit keep that choice.
	const chosen = `${await row("aa-second").getAttribute("data-extension")}/view`;
	await feedback.selectOption(chosen);
	await expect(page.getByText("Provider A", { exact: true })).toBeVisible();
	writeFileSync(join(directory, "aa-second", "label.js"), 'export default "Provider A2";\n');
	await management.getByRole("button", { name: "Reload extensions", exact: true }).click();
	await expect(page.getByText("Provider A2", { exact: true })).toBeVisible();
	expect(saved()).toBe(chosen);
});
