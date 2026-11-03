import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { emulatorBindings } from "./test/emulators.ts";

// Secrets are miniflare bindings so the suite runs on a clean checkout. web/dist does not
// exist until the web app is built, so the assets binding points at a committed fixture.
// KEK (Secrets Store) is not emulated; tests read the plain TEST_KEK binding instead.
/** The keys of a developer's .dev.vars, which the pool also reads: tests never run with someone's real credentials. */
const devVarKeys = (): string[] => {
	const file = fileURLToPath(new URL("./.dev.vars", import.meta.url));
	return existsSync(file) ? [...readFileSync(file, "utf8").matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]!) : [];
};

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
					// Unset (empty) unless a test binding below sets it.
					...Object.fromEntries(devVarKeys().map((key) => [key, ""])),
					// The emulated GitHub, Google and the rest, started here in Node; test/global-setup.ts stops them.
					...(await emulatorBindings()),
					SESSION_SECRET: "test-session-secret",
					// Pinned, so a developer's .dev.vars (which the pool also reads) never changes the callbacks tests expect.
					APP_ORIGIN: "https://bots.knightcode.dev",
					// The pool runs no containers: the computer object uses its fake provider.
					BOTS_COMPUTER_PROVIDER: "fake",
					// Trigger sources' signing secrets, for tests that sign events as the sources do.
					GITHUB_APP_WEBHOOK_SECRET: "test-github-webhook-secret",
					SLACK_SIGNING_SECRET: "test-slack-signing-secret",
					STRIPE_WEBHOOK_SECRET: "test-stripe-webhook-secret",
					// A throwaway pair for tests only.
					VAPID_PUBLIC_KEY: "BLtNfT_HbYjlAJeSSN1IjVrICQmZ2Znziz4jjHPJpULIhKlS0_2uTcl_iSQdIerJOcTmWH4658kCIXfzeNvIiWI",
					VAPID_PRIVATE_KEY: "e_yON4PMcfC5CstZ_Aye7dvjIitnKezFUJ0amJbNK-o",
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
