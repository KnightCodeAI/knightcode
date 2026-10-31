import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "../../vitest.base.ts";

export default mergeConfig(
	baseConfig,
	defineConfig({
		test: {
			globals: true,
			environment: "node",
			testTimeout: 30000,
			// Tests run offline by default; opt in with allowNetwork() from test/test-network-env.ts. Plugin discovery reads
			// Claude Code's and Grok Build's folders; point both at nothing so no test sees the developer's own.
			env: {
				KNIGHTCODE_OFFLINE: "1",
				CLAUDE_CONFIG_DIR: fileURLToPath(new URL("./test/.no-home/claude", import.meta.url)),
				GROK_HOME: fileURLToPath(new URL("./test/.no-home/grok", import.meta.url)),
			},
			unstubEnvs: true,
			reporters: process.env.GITHUB_ACTIONS ? ["dot", "github-actions"] : ["dot"],
			silent: "passed-only",
			server: {
				deps: {
					external: [/@silvia-odwyer\/photon-node/],
				},
			},
		},
	}),
);
