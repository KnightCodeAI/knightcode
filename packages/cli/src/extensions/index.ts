import remoteExtension from "@knightcode/remote";
import toolsExtension from "@knightcode/tools";
import type { InlineExtension } from "../core/extensions/types.ts";
import codemodeExtension from "./codemode/index.ts";
import llamaExtension from "./llama/index.ts";
import mcpExtension from "./mcp/index.ts";
import planMode from "./plan-mode/index.ts";
import pluginsExtension from "./plugins/index.ts";
import pluginMcpExtension from "./plugins/mcp.ts";
import toolSearchExtension from "./tool-search/index.ts";
import { turnMarkerExtension } from "./turn-marker.ts";
import uiExtension from "./ui/index.ts";
import undoExtension from "./undo/index.ts";
import usageExtension from "./usage/index.ts";

export const builtInExtensions: InlineExtension[] = [
	// First so live and persisted turns share the marker entry's id.
	turnMarkerExtension,
	{ name: "llama.cpp", factory: llamaExtension, builtin: true },
	// Replaceable: an extension that registers `codemode`, `tool_search`, or `/mcp` (such as a third-party
	// MCP extension) takes over instead of running alongside the built-in one.
	{ name: "codemode", factory: codemodeExtension, replaceable: true, builtin: true },
	{ name: "tool-search", factory: toolSearchExtension, replaceable: true, builtin: true },
	{ name: "mcp", factory: mcpExtension, replaceable: true, builtin: true },
	// Claude Code and Grok Build plugins: skills and commands, and (separately, so --no-mcp drops them) MCP servers.
	// After "mcp", whose session_start must run first to connect what plugin-mcp registers in its own.
	{ name: "plugins", factory: pluginsExtension, builtin: true },
	{ name: "plugin-mcp", factory: pluginMcpExtension, builtin: true },
	// /undo is a built-in command; file checkpoints ride on the extension hooks so core stays untouched.
	{ name: "undo", factory: undoExtension, builtin: true },
	// /usage is a built-in command.
	{ name: "usage", factory: usageExtension, builtin: true },
	// /remote is a built-in command. Listing it under "Extensions" at startup would advertise an
	// implementation detail as an add-on.
	{ name: "remote", factory: remoteExtension, builtin: true },
	// Enforce planning before the tools extension's classifier gate.
	{ name: "plan-mode", factory: planMode, replaceable: true, builtin: true },
	// webfetch, websearch and /tools are built-ins.
	{ name: "tools", factory: toolsExtension, builtin: true },
	// KnightCode's header, editor frame and footer. Kept out of modes/interactive so resyncs never touch it.
	{ name: "ui", factory: uiExtension, builtin: true },
];

/** Built-ins that `--no-mcp` turns off: plugin servers registered while nothing connects them are errors. */
export const MCP_BUILTIN_EXTENSIONS = ["mcp", "plugin-mcp"];
