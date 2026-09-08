import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// vitest-pool-workers 0.22 is a Vite plugin; the older `defineWorkersConfig` from
// the "./config" subpath no longer exists.
//
// Secrets are supplied as miniflare bindings rather than read from .dev.vars, so the
// suite runs on a clean checkout and in CI where that untracked file does not exist.
export default defineConfig({
	plugins: [
		cloudflareTest(async () => ({
			wrangler: { configPath: "./wrangler.jsonc" },
			miniflare: {
				compatibilityDate: "2026-08-22",
				compatibilityFlags: ["nodejs_compat"],
				bindings: {
					SIGNING_SECRET: "test-signing-secret",
					GITHUB_CLIENT_ID: "test-client-id",
					GITHUB_CLIENT_SECRET: "test-client-secret",
					TEST_MIGRATIONS: await readD1Migrations(fileURLToPath(new URL("./migrations", import.meta.url))),
				},
			},
		})),
	],
	test: {
		// The browser app's tests live under web/test and run on node via web/vitest.config.ts.
		include: ["test/**/*.test.ts"],
		setupFiles: ["./test/apply-migrations.ts"],
	},
});
