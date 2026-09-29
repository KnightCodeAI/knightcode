import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		// QuickJS starts from WASM. That exceeds vitest's 5s default when every package suite runs at once.
		testTimeout: 30_000,
		reporters: process.env.GITHUB_ACTIONS ? ["dot", "github-actions"] : ["dot"],
	},
});
