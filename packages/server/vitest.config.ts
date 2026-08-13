import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		reporters: process.env.GITHUB_ACTIONS ? ["dot", "github-actions"] : ["dot"],
	},
	resolve: {
		alias: {
			"@knightcode/agent": fileURLToPath(new URL("../agent/src/index.ts", import.meta.url)),
			"@knightcode/ai": fileURLToPath(new URL("../ai/src/index.ts", import.meta.url)),
			"@knightcode/telemetry": fileURLToPath(new URL("../telemetry/src/index.ts", import.meta.url)),
			"@knightcode/protocol": fileURLToPath(new URL("../protocol/src/index.ts", import.meta.url)),
		},
	},
});
