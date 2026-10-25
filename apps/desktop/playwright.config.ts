import { defineConfig } from "@playwright/test";

// The end-to-end tests (test/e2e/*.e2e.ts), apart from Vitest's *.test.ts. They launch the production Vite build in
// .vite/, which `bun run package` leaves behind: `bun run test:e2e`.
export default defineConfig({
	testDir: "test/e2e",
	testMatch: "**/*.e2e.ts",
	// One Electron app at a time: each test launches its own.
	workers: 1,
	timeout: 90_000,
	expect: { timeout: 20_000 },
	reporter: process.env.CI ? [["list"], ["github"]] : "list",
	retries: process.env.CI ? 1 : 0,
});
