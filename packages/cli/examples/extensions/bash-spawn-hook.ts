/**
 * Bash Spawn Hook Example
 *
 * Adjusts command, cwd, and env before execution.
 *
 * Usage:
 *   knightcode -e ./bash-spawn-hook.ts
 */

import type { ExtensionAPI } from "@knightcodeai/cli";
import { createBashTool } from "@knightcodeai/cli";

export default function (knightcode: ExtensionAPI) {
	const cwd = process.cwd();

	const bashTool = createBashTool(cwd, {
		spawnHook: ({ command, cwd, env }) => ({
			command: `source ~/.profile\n${command}`,
			cwd,
			env: { ...env, KNIGHTCODE_SPAWN_HOOK: "1" },
		}),
	});

	knightcode.registerTool({
		...bashTool,
		execute: async (id, params, signal, onUpdate, _ctx) => {
			return bashTool.execute(id, params, signal, onUpdate);
		},
	});
}
