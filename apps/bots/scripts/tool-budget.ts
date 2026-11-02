// Fails when the tool definitions a bot's model sees on every request (its visible tools and tool_search) pass 6 KB.
// Deferred tools cost nothing until tool_search loads them, so they are not counted. Run: bun scripts/tool-budget.ts
// (typechecked with the Worker's tsconfig, since it builds Worker code).
import type { BotMemory } from "../src/memory/memory.ts";
import { botExtensions, TOOL_BUDGET_BYTES, visibleToolBytes, visibleToolDefinitions } from "../src/tools/catalog.ts";
import type { SettingsStore } from "../src/tools/settings-tool.ts";
import type { ToolRegistration } from "@knightcode/durable";
import { type FleetDeps, fleetTools } from "../src/team/fleet.ts";
import { startHelperTool } from "../src/team/helpers.ts";
import { messageBotTool } from "../src/team/message-bot.ts";

// Building the definitions touches none of these; stand-ins keep the script off Workers storage.
const { core, toolSearch } = botExtensions({
	settings: {} as SettingsStore,
	memory: { history: {}, notes: {}, openWork: {} } as unknown as BotMemory,
	knowledge: { list: async () => [], read: async () => undefined },
	help: {},
	// The largest set: a bot with computer access.
	computer: { browser: async () => ({}), desktop: async () => ({}), fillLogin: async () => ({}) },
	gate: async () => ({ decision: "refuse", reason: "budget" }),
	// A manager bot: messaging, helpers and the management tools too.
	extraTools: [
		messageBotTool({ directory: { bots: async () => [] }, hop: () => 0, send: async () => ({ ok: false, reason: "budget" }) }),
		{ ...startHelperTool({ tools: () => [], inherit: async () => {} }), deferred: true as const },
		...fleetTools({} as FleetDeps),
	] as ToolRegistration[],
});
const tools = [...(core.tools ?? []), ...(toolSearch.tools ?? [])];
const bytes = visibleToolBytes(tools);
for (const tool of visibleToolDefinitions(tools))
	console.log(`${tool.name.padEnd(16)} ${new TextEncoder().encode(JSON.stringify(tool)).length} bytes`);
console.log(`visible tools: ${bytes} of ${TOOL_BUDGET_BYTES} bytes`);
// An uncaught error exits non-zero, which is the failure.
if (bytes > TOOL_BUDGET_BYTES) throw new Error("over the tool budget: shorten descriptions or defer tools behind tool_search");
