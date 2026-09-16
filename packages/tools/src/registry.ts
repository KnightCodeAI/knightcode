import type { ToolDefinition } from "@knightcodeai/cli";
import { webfetchTool } from "./web/fetch.ts";
import { websearchTool } from "./web/search.ts";

// Same alias the engine uses for heterogeneous tool lists (core/tools/index.ts `ToolDef`); it is not
// exported, and renderCall's parameter type makes a ToolDefinition<TSchema> list unassignable.
export type AnyToolDefinition = ToolDefinition<any, any>;

export interface RegisteredToolEntry {
	tool: AnyToolDefinition;
	defaultEnabled: boolean;
}

/** Every KnightCode-native tool. A new tool is one file under src/ and one line here. */
export const TOOLS: RegisteredToolEntry[] = [
	{ tool: webfetchTool, defaultEnabled: true },
	{ tool: websearchTool, defaultEnabled: true },
];
