import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export const workspaceSourcePaths = {
	telemetryIndex: fileURLToPath(new URL("./packages/telemetry/src/index.ts", import.meta.url)),
	telemetryTesting: fileURLToPath(new URL("./packages/telemetry/src/testing/index.ts", import.meta.url)),
	aiIndex: fileURLToPath(new URL("./packages/ai/src/index.ts", import.meta.url)),
	aiCompat: fileURLToPath(new URL("./packages/ai/src/compat.ts", import.meta.url)),
	aiOAuth: fileURLToPath(new URL("./packages/ai/src/oauth.ts", import.meta.url)),
	aiProviders: fileURLToPath(new URL("./packages/ai/src/providers", import.meta.url)),
	agentIndex: fileURLToPath(new URL("./packages/agent/src/index.ts", import.meta.url)),
	codingAgentIndex: fileURLToPath(new URL("./packages/cli/src/index.ts", import.meta.url)),
	tuiIndex: fileURLToPath(new URL("./packages/tui/src/index.ts", import.meta.url)),
} as const;

export default defineConfig({
	resolve: {
		alias: [
			{ find: /^@knightcode\/telemetry$/, replacement: workspaceSourcePaths.telemetryIndex },
			{ find: /^@knightcode\/telemetry\/testing$/, replacement: workspaceSourcePaths.telemetryTesting },
			{ find: /^@knightcode\/ai$/, replacement: workspaceSourcePaths.aiIndex },
			{ find: /^@knightcode\/ai\/compat$/, replacement: workspaceSourcePaths.aiCompat },
			{ find: /^@knightcode\/ai\/oauth$/, replacement: workspaceSourcePaths.aiOAuth },
			{
				find: /^@knightcode\/ai\/providers\/(.+)$/,
				replacement: `${workspaceSourcePaths.aiProviders}/$1.ts`,
			},
			{ find: /^@knightcode\/agent$/, replacement: workspaceSourcePaths.agentIndex },
			{ find: /^@knightcode\/tui$/, replacement: workspaceSourcePaths.tuiIndex },
		],
	},
});
