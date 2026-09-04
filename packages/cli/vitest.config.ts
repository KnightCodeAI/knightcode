import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig, { workspaceSourcePaths } from "../../vitest.base.ts";

export default mergeConfig(
	baseConfig,
	defineConfig({
		test: {
			globals: true,
			environment: "node",
			testTimeout: 30000,
			// Tests run offline by default; opt in with allowNetwork() from test/test-network-env.ts.
			env: { KNIGHTCODE_OFFLINE: "1" },
			unstubEnvs: true,
			reporters: process.env.GITHUB_ACTIONS ? ["dot", "github-actions"] : ["dot"],
			silent: "passed-only",
			server: {
				deps: {
					external: [/@silvia-odwyer\/photon-node/],
				},
			},
		},
		resolve: {
			alias: [
				{
					find: /^@knightcode\/client\/unix$/,
					replacement: fileURLToPath(new URL("../client/src/unix.ts", import.meta.url)),
				},
				{
					find: /^@knightcode\/server\/unix$/,
					replacement: fileURLToPath(new URL("../server/src/transports/unix/index.ts", import.meta.url)),
				},
				{
					find: /^@knightcode\/server$/,
					replacement: fileURLToPath(new URL("../server/src/index.ts", import.meta.url)),
				},
				{
					find: /^@knightcode\/client$/,
					replacement: fileURLToPath(new URL("../client/src/index.ts", import.meta.url)),
				},
				{
					find: /^@knightcode\/protocol$/,
					replacement: fileURLToPath(new URL("../protocol/src/index.ts", import.meta.url)),
				},
			],
		},
	}),
);
