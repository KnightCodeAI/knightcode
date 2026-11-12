/** Same-platform, zero-diff snapshots. Recording requires an explicit --update-snapshots invocation. */
import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "test/parity",
	testMatch: "**/*.e2e.ts",
	workers: 1,
	timeout: 120_000,
	expect: {
		timeout: 20_000,
		toHaveScreenshot: { maxDiffPixels: 0, threshold: 0, animations: "disabled", caret: "hide" },
	},
	updateSnapshots: "none",
	snapshotPathTemplate: "{testDir}/baselines/{platform}/{projectName}/{arg}{ext}",
	outputDir: "test-results/parity",
	reporter: "list",
	forbidOnly: !!process.env.CI,
	retries: 0,
	use: { locale: "en-US", timezoneId: "UTC", reducedMotion: "reduce", trace: "retain-on-failure" },
	projects: [
		{ name: "light-wide", use: { colorScheme: "light", viewport: { width: 1280, height: 820 } } },
		{ name: "dark-wide", use: { colorScheme: "dark", viewport: { width: 1280, height: 820 } } },
		{ name: "light-narrow", use: { colorScheme: "light", viewport: { width: 800, height: 700 } } },
		{ name: "dark-narrow", use: { colorScheme: "dark", viewport: { width: 800, height: 700 } } },
	],
});
