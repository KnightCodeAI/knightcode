import type { SettingItem } from "@knightcode/tui";
import type { Theme, ToolDefinition } from "@knightcodeai/cli";
import type { ToolSettings } from "./state.ts";
import { webfetchTool } from "./web/fetch.ts";
import { websearchSettings } from "./web/search-settings.ts";
import { websearchTool } from "./web/search.ts";
import { scratchpadEntry } from "./scratchpad.ts";

// Same alias the engine uses for heterogeneous tool lists (core/tools/index.ts `ToolDef`); it is not
// exported, and renderCall's parameter type makes a ToolDefinition<TSchema> list unassignable.
export type AnyToolDefinition = ToolDefinition<any, any>;

/** A /tools entry with no engine tool of its own; the extension reads its enabled state itself. */
export interface FeatureTool {
	name: string;
	feature: true;
}

export interface RegisteredToolEntry {
	tool: AnyToolDefinition | FeatureTool;
	defaultEnabled: boolean;
	/** Extra /tools rows; each row's id is the key it stores in the tool's settings. */
	settings?: (current: ToolSettings, theme: Theme) => SettingItem[];
}

/** Every KnightCode-native tool. A new tool is one file under src/ and one line here. */
export const TOOLS: RegisteredToolEntry[] = [
	{ tool: webfetchTool, defaultEnabled: false },
	{ tool: websearchTool, defaultEnabled: false, settings: websearchSettings },
	scratchpadEntry,
];
