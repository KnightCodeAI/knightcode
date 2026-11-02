import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { emulatorBindings } from "./test/emulators.ts";

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
					// The emulated GitHub, Google and the rest, started here in Node; test/global-setup.ts stops them.
					...(await emulatorBindings()),
					SESSION_SECRET: "test-session-secret",
					// The pool runs no containers: the computer object uses its fake provider.
					BOTS_COMPUTER_PROVIDER: "fake",
					// Trigger sources' signing secrets, for tests that sign events as the sources do.
					GITHUB_APP_WEBHOOK_SECRET: "test-github-webhook-secret",
					SLACK_SIGNING_SECRET: "test-slack-signing-secret",
					STRIPE_WEBHOOK_SECRET: "test-stripe-webhook-secret",
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
		globalSetup: ["./test/global-setup.ts"],
	},
});
