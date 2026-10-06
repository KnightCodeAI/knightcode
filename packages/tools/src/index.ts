import type { ExtensionAPI } from "@knightcodeai/cli";
import { registerClassifierGate } from "./classifier-gate.ts";
import { toolsCommand, toolsCompletions } from "./command.ts";
import { TOOLS } from "./registry.ts";
import { applyActiveTools } from "./state.ts";
import { registerScratchpad } from "./scratchpad.ts";

/**
 * KnightCode-native tools as a hidden built-in extension: every registry tool is registered here
 * (a feature entry has no tool), /tools sets each entry to off / on for this session / on by
 * default, and session_start reconciles the engine's active set with that state.
 */
export default function toolsExtension(pi: ExtensionAPI): void {
	// Inactive on registration: session_start turns on the enabled ones, so a tool that is off by
	// default never needs removing and stays on when something else activates it.
	for (const entry of TOOLS) if (!("feature" in entry.tool)) pi.registerTool({ ...entry.tool, defaultActive: false });
	pi.registerCommand("tools", {
		description: "Enable or disable KnightCode tools: off, for this session, or by default",
		getArgumentCompletions: (prefix) => toolsCompletions(prefix),
		handler: (args, ctx) => toolsCommand(args, ctx, pi),
	});
	pi.on("session_start", () => {
		applyActiveTools(pi, TOOLS);
	});
	registerScratchpad(pi);
	registerClassifierGate(pi);
}
