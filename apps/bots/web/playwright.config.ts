// Browser tests for the web app. Project `ui`: behaviour, plus committed baselines of KnightCode's own screens.
// Project `reference`: each screen against the local reference captures (skipped when they are absent).
import { defineConfig } from "@playwright/test";
import { REFERENCE_DIR } from "./vite.config.ts";

const PORT = 5190;
/** BOTS_BACKEND=real runs against the real Worker (e2e/global-setup.ts); the default is the in-memory fake. */
const REAL = process.env.BOTS_BACKEND === "real";
const REFERENCE_TITLE = /matches the reference/;

export default defineConfig({
	testDir: "e2e",
	testMatch: "**/*.e2e.ts",
	// The real backend shares one wrangler dev, and every test seeds the same bot ids: one at a time there.
	fullyParallel: !REAL,
	// No retries: a test that passes only on a second try is a failure to fix, not a pass. The real Worker keeps its
	// objects in local SQLite, so a busy disk stalls it for seconds at a time: waits are sized for that, not for the fake.
	...(REAL ? { workers: 1, globalSetup: "./e2e/global-setup.ts", timeout: 120_000 } : {}),
	forbidOnly: Boolean(process.env.CI),
	// Never write a missing snapshot: in the reference project that would put our own screen where the reference
	// capture belongs. New baselines are made explicitly with --update-snapshots.
	updateSnapshots: "none",
	reporter: process.env.CI ? "github" : "list",
	use: {
		baseURL: `http://localhost:${PORT}`,
		viewport: { width: 1440, height: 900 },
		deviceScaleFactor: 1,
		timezoneId: "Asia/Kolkata",
		locale: "en-US",
		// Avatars blink and glance; screenshots need them still, as reduced motion makes them.
		contextOptions: { reducedMotion: "reduce" },
	},
	expect: { ...(REAL ? { timeout: 30_000 } : {}), toHaveScreenshot: { animations: "disabled", caret: "hide", scale: "css" } },
	projects: [
		{
			name: "ui",
			grepInvert: REFERENCE_TITLE,
			snapshotPathTemplate: "{testDir}/__screenshots__/{testFileName}/{arg}{ext}",
		},
		{
			name: "reference",
			grep: REFERENCE_TITLE,
			// compare.ts names the capture; Playwright reads it from the reference folder and never writes there.
			snapshotPathTemplate: `${REFERENCE_DIR.replace(/\\/g, "/")}/screens/{arg}{ext}`,
		},
	],
	webServer: {
		command: `bunx vite --port ${PORT} --strictPort`,
		url: `http://localhost:${PORT}`,
		env: REAL ? { BOTS_API_URL: "http://127.0.0.1:8799", BOTS_REFERENCE_DIR: REFERENCE_DIR } : { VITE_FAKE: "1", BOTS_REFERENCE_DIR: REFERENCE_DIR },
		// A server left from the other mode would serve the wrong backend.
		reuseExistingServer: !process.env.CI && !REAL,
		timeout: 60_000,
	},
});
