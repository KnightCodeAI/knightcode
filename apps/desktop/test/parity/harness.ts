/** The parity fixture: real production Electron against the faux app server, isolated per test, and the capture rules. */
import { existsSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { _electron as electron, type ElectronApplication, expect, type Page, test as base } from "@playwright/test";
import { createDesktopFixture, type DesktopFixture, type DesktopFixtureOptions } from "../fixtures/desktop.ts";

const DESKTOP = resolve(__dirname, "../..");
const REPO = resolve(DESKTOP, "../..");
const FAUX_SERVER = resolve(REPO, "packages/cli/test/fixtures/faux-app-server.ts");
export const MOD = process.platform === "darwin" ? "Meta" : "Control";

export interface RunningDesktop extends DesktopFixture {
	app: ElectronApplication;
	page: Page;
	/** Quit and start again on the same profile, agent dir and project, as a user reopening the app would. */
	relaunch(options?: { safeMode?: boolean }): Promise<void>;
}

type Extras = Pick<DesktopFixtureOptions, "counter" | "dialogs">;

export const test = base.extend<{ desktop: RunningDesktop; untrustedProject: boolean; extras: Extras }>({
	untrustedProject: [false, { option: true }],
	extras: [{}, { option: true }],
	desktop: async ({ untrustedProject, extras }, use, info) => {
		if (!existsSync(join(DESKTOP, ".vite/renderer/main_window/index.html")))
			throw new Error("No production desktop build. Run stage-server.ts, then `bun run package` in apps/desktop.");
		const theme = info.project.use.colorScheme === "dark" ? "dark" : "light";
		const size = info.project.use.viewport ?? { width: 1280, height: 820 };
		const fixture = createDesktopFixture({ theme, projectSettings: untrustedProject, ...extras });
		if (!fixture.fd)
			throw new Error("Parity tests need fd for @ suggestions: set KNIGHTCODE_PARITY_FD or put fd on PATH.");
		let launches = 0;
		let app: ElectronApplication | undefined;

		const start = async (options?: { safeMode?: boolean }): Promise<Page> => {
			app = await electron.launch({
				args: [
					DESKTOP,
					`--user-data-dir=${fixture.userData}`,
					"--lang=en-US",
					...(options?.safeMode ? ["--safe-mode"] : []),
					"--force-device-scale-factor=1",
					`knightcode://new?cwd=${encodeURIComponent(fixture.project)}`,
					...(process.platform === "linux" ? ["--no-sandbox"] : []),
				],
				env: { ...fixture.env, KNIGHTCODE_DESKTOP_SERVER: `bun ${FAUX_SERVER}` },
				locale: "en-US",
				timezoneId: "UTC",
				colorScheme: theme,
			});
			launches++;
			// A rare startup leaves #root empty with no trace events; keep main's output and every renderer's
			// console from the first moment, so the next occurrence says why.
			const launch = launches;
			const output: string[] = [];
			logs.set(launch, output);
			app.process().stdout?.on("data", (chunk) => output.push(`[main stdout] ${chunk}`));
			app.process().stderr?.on("data", (chunk) => output.push(`[main stderr] ${chunk}`));
			const listen = (page: Page) => {
				page.on("console", (message) => output.push(`[console ${message.type()}] ${message.text()}`));
				page.on("pageerror", (error) => output.push(`[pageerror] ${error.stack ?? error.message}`));
			};
			app.windows().forEach(listen);
			app.on("window", listen);
			await app.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
			const page = await app.firstWindow();
			await settle(app, page, theme, size);
			return page;
		};
		const logs = new Map<number, string[]>();
		const stop = async (): Promise<void> => {
			const running = app;
			app = undefined;
			if (!running) return;
			// Quit must not wait for a native question when a screenshot captured a pending approval.
			await running
				.evaluate(({ dialog }) => {
					dialog.showMessageBoxSync = () => 0;
				})
				.catch(() => {});
			try {
				const trace = info.outputPath(`electron-trace-${launches}.zip`);
				await running.context().tracing.stop({ path: trace });
				await info.attach(`electron-trace-${launches}`, { path: trace, contentType: "application/zip" });
			} finally {
				await running.close();
				const output = logs.get(launches);
				if (output?.length)
					await info.attach(`electron-output-${launches}`, { body: output.join("\n"), contentType: "text/plain" });
			}
		};

		try {
			const page = await start();
			// Only a project with its own resources asks for trust; an ordinary one must not, or a leaked
			// developer resource (an ancestor's .agents/skills) is being picked up.
			if (!untrustedProject) await expect(page.getByRole("button", { name: "Trust", exact: true })).toHaveCount(0);
			const desktop: RunningDesktop = {
				...fixture,
				app: app as ElectronApplication,
				page,
				relaunch: async (options) => {
					await stop();
					desktop.page = await start(options);
					desktop.app = app as ElectronApplication;
				},
			};
			await use(desktop);
		} finally {
			try {
				try {
					await stop();
				} finally {
					const log = join(fixture.userData, "logs", "app-server.log");
					if (existsSync(log)) await info.attach("app-server.log", { path: log, contentType: "text/plain" });
				}
			} finally {
				rmSync(fixture.root, { recursive: true, force: true, maxRetries: 5 });
			}
		}
	},
});

/** A window at the project's exact content size, theme and fonts, connected to the faux model. */
export async function settle(
	app: ElectronApplication,
	page: Page,
	theme: "light" | "dark",
	size: { width: number; height: number },
): Promise<void> {
	const window = await app.browserWindow(page);
	await window.evaluate((win, viewport) => win.setContentSize(viewport.width, viewport.height), size);
	await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
	await expect(page.getByText("Faux E2E").first()).toBeVisible();
	await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
	await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual(size);
	await page.evaluate(() => document.fonts.ready);
	// Keep a previous window's pointer from selecting an option as the next question opens.
	await page.mouse.move(0, 0);
}

export async function capture(desktop: RunningDesktop, name: string, page = desktop.page): Promise<void> {
	const { root } = desktop;
	await page.mouse.move(0, 0);
	// A button keeps focus after its menu or dialog closes, and a focused button grows a tooltip after a delay. Outside
	// a dialog or menu that focus is incidental: drop it. A test that wants a focused control focuses one in a dialog.
	await page.evaluate(() => {
		const active = document.activeElement;
		if (
			active instanceof HTMLElement &&
			active !== document.body &&
			!active.closest("[role=dialog], [role=menu], [role=listbox]") &&
			!active.matches("input, textarea, [contenteditable=true]")
		)
			active.blur();
	});
	await expect(page.getByRole("tooltip")).toHaveCount(0);
	// Rewrite text nodes before capture: masking after compositing still leaks changing glyphs into dialog backdrops'
	// blur, and fixed text keeps proportional layout stable. Only run-dependent values change; no UI is hidden. React
	// can write a node back mid-capture, so an observer keeps rewriting until the screenshot is taken.
	await page.evaluate(
		(paths) => {
			const rules: [RegExp, string][] = [
				// Scratch, checkout and Node paths: where the developer put them, not what the UI does with them.
				...paths.map(([path, name]): [RegExp, string] => [
					new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
					name,
				]),
				// Archived rows' date and time, then any clock time.
				[/[A-Z][a-z]{2} \d{1,2}, \d{4},? \d{1,2}:\d{2}\s?[AP]M/g, "Jan 1, 2026, 12:00 PM"],
				[/\b\d{1,2}:\d{2}(?:\s?[AP]M)?\b/g, "12:00 PM"],
				// Turn durations.
				[/\b(Worked|Working) for \d+[hms](?: \d+[ms])*/g, "$1 for 1s"],
				// The desktop's own commits carry the current time, so their hashes differ on every run.
				[/\bCommitted [0-9a-f]{7}:/g, "Committed 0000000:"],
				// Release bumps change version numbers (About, update notices) without changing any UI.
				[/^v?\d+\.\d+\.\d+(?:-[\w.]+)?$/, "0.0.0"],
			];
			const normalize = (root: Node) => {
				const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
				for (
					let node: Node | null = root.nodeType === Node.TEXT_NODE ? root : walker.nextNode();
					node;
					node = walker.nextNode()
				) {
					const before = node.textContent ?? "";
					const after = rules.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), before);
					if (after !== before) node.textContent = after;
				}
			};
			normalize(document.body);
			const observer = new MutationObserver((records) => {
				for (const record of records) {
					if (record.type === "characterData") normalize(record.target);
					for (const added of record.addedNodes) normalize(added);
				}
			});
			observer.observe(document.body, { subtree: true, childList: true, characterData: true });
			(window as unknown as { parityObserver?: MutationObserver }).parityObserver = observer;
		},
		[
			[process.execPath, "<node>"],
			[root, "<fixture>"],
			[REPO, "<repo>"],
		].flatMap(
			([path, name]) =>
				[
					[path, name],
					[path.replaceAll("\\", "/"), name],
				] as [string, string][],
		),
	);
	try {
		await expect(page).toHaveScreenshot(`${name}.png`, {
			mask: [page.getByRole("textbox", { name: "Address", exact: true })],
		});
	} finally {
		await page.evaluate(() =>
			(window as unknown as { parityObserver?: MutationObserver }).parityObserver?.disconnect(),
		);
	}
}

export async function send(page: Page, prompt: string): Promise<void> {
	const input = page.getByRole("textbox", { name: "Message", exact: true });
	await input.fill(prompt);
	await input.press("Enter");
}

export async function openSettings(page: Page, name: string): Promise<void> {
	await page.keyboard.press(`${MOD}+Comma`);
	await page.getByRole("button", { name, exact: true }).click();
	await expect(page.getByRole("heading", { name, level: 1, exact: true })).toBeVisible();
}
