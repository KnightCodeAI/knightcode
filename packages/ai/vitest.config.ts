import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const telemetrySrcIndex = fileURLToPath(new URL("../telemetry/src/index.ts", import.meta.url));

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		testTimeout: 30000, // 30 seconds for API calls
		reporters: process.env.GITHUB_ACTIONS ? ["dot", "github-actions"] : ["dot"],
		silent: "passed-only",
		// Local-LLM E2E is opt-in, like the provider tests that need API keys.
		// Left on by default these suites pull a ~13GB model on first run and then
		// assert real model behaviour, which is slow and not deterministic.
		// Run them with: KNIGHTCODE_NO_LOCAL_LLM= bunx vitest --run
		env: { KNIGHTCODE_NO_LOCAL_LLM: process.env.KNIGHTCODE_NO_LOCAL_LLM ?? "1" },
	},
	resolve: {
		alias: [{ find: /^@knightcode\/telemetry$/, replacement: telemetrySrcIndex }],
	},
});
