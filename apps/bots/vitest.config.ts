import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Secrets are miniflare bindings so the suite runs on a clean checkout. web/dist does not
// exist until the web app is built, so the assets binding points at a committed fixture.
// KEK (Secrets Store) is not emulated; tests read the plain TEST_KEK binding instead.
export default defineConfig({
	plugins: [
		cloudflareTest(async () => ({
			wrangler: { configPath: "./wrangler.jsonc" },
			miniflare: {
				compatibilityDate: "2026-08-22",
				compatibilityFlags: ["nodejs_compat"],
				assets: {
					directory: fileURLToPath(new URL("./test/fixtures/assets", import.meta.url)),
					binding: "ASSETS",
					routerConfig: { invoke_user_worker_ahead_of_assets: true },
					assetConfig: { html_handling: "none" },
				},
				bindings: {
					SESSION_SECRET: "test-session-secret",
					// 32 zero bytes, base64.
					TEST_KEK: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
					TEST_MIGRATIONS: await readD1Migrations(fileURLToPath(new URL("./migrations", import.meta.url))),
				},
			},
		})),
	],
	test: {
		include: ["test/**/*.test.ts"],
		setupFiles: ["./test/apply-migrations.ts"],
	},
});
