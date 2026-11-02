// The bot's tools as one durable extension, "bots-core" (spec section 5): a short core list the model always sees,
// everything else deferred behind tool_search (connectors and skills join that set in Part 3). Its prompt sections
// carry what changes, the knowledge files and the memory index with open work, last, after the stable parts.
import type { FileRef } from "@knightcode/bots-protocol";
import { defineExtension, defineTool, type Extension, section, type ToolRegistration } from "@knightcode/durable";
import { createToolSearchExtension } from "@knightcode/durable/tool-search";
import { lit, obj, opt, str, union } from "@knightcode/schema";
import { historyTools } from "../memory/history-tools.ts";
import { memoryText } from "../memory/index-file.ts";
import type { BotMemory } from "../memory/memory.ts";
import { type HelpDocs, helpTool } from "./help-skill.ts";
import { imageTool } from "./image-tool.ts";
import type { SettingsStore } from "./settings-tool.ts";
import { updateBotTool } from "./settings-tool.ts";
import { webTools } from "./web-fetch.ts";

/** The visible tool definitions may take at most this much of every request. */
export const TOOL_BUDGET_BYTES = 6 * 1024;

export interface Knowledge {
	list(): Promise<FileRef[]>;
	/** The file's text, or undefined when there is no knowledge file by that name. */
	read(name: string): Promise<string | undefined>;
}

export interface BotToolDeps {
	settings: SettingsStore;
	memory: BotMemory;
	knowledge: Knowledge;
	help: HelpDocs;
	/** Present only when one of the user's providers has an image model. */
	image?: Parameters<typeof imageTool>[0];
}

const KNOWLEDGE_MAX = 50_000;
const text = (value: string, isError = false) => ({ output: [{ type: "text" as const, text: value }], ...(isError ? { isError } : {}) });

function memoryTools(memory: BotMemory) {
	return [
		defineTool({
			name: "save_note",
			description: "Remember one fact for later chats. Reuse a name to correct a note.",
			parameters: obj({
				name: str({ description: "short-kebab-name" }),
				description: str({ description: "one line" }),
				body: str(),
				type: opt(union([lit("fact"), lit("preference"), lit("decision"), lit("reference")])),
			}),
			execute: async (args) => text(`Saved ${memory.notes.write(args).name}.`),
		}),
	];
}

function knowledgeTool(knowledge: Knowledge) {
	return defineTool({
		name: "read_knowledge",
		description: "Read one of your knowledge files by name.",
		parameters: obj({ name: str() }),
		execute: async ({ name }) => {
			const content = await knowledge.read(name);
			if (content === undefined) return text("not found", true);
			return text(content.length > KNOWLEDGE_MAX ? `${content.slice(0, KNOWLEDGE_MAX)}\n…(truncated)` : content);
		},
	});
}

/** Every tool of the bot, the visible ones first. */
export function botTools(deps: BotToolDeps): ToolRegistration[] {
	return [
		updateBotTool(deps.settings),
		...memoryTools(deps.memory),
		...historyTools(deps.memory.history),
		knowledgeTool(deps.knowledge),
		...webTools(),
		helpTool(deps.help),
		...(deps.image && deps.image.available.length > 0 ? [imageTool(deps.image)] : []),
	] as ToolRegistration[];
}

/** The bot's extensions: its own tools and sections, and tool search over the deferred ones. */
export function botExtensions(deps: BotToolDeps): { core: Extension; toolSearch: Extension } {
	return {
		core: defineExtension({
			name: "bots-core",
			tools: botTools(deps),
			sections: [
				section("knowledge", async () => {
					const files = await deps.knowledge.list().catch(() => []);
					return files.length > 0
						? `Your knowledge files (read one with read_knowledge):\n${files.map((file) => `- ${file.name}`).join("\n")}`
						: undefined;
				}),
				// Last: it changes the most, and the provider's cached prefix ends before it.
				section("memory", () => memoryText(deps.memory.notes, deps.memory.openWork)),
			],
		}),
		toolSearch: createToolSearchExtension(),
	};
}

/** What the model sees of each offered tool, as sent: name, description and parameters. */
export function visibleToolDefinitions(tools: readonly ToolRegistration[]): { name: string; description: string; parameters: unknown }[] {
	return tools
		.filter((tool) => !tool.deferred)
		.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
}

/** The bytes the visible definitions take as JSON. */
export const visibleToolBytes = (tools: readonly ToolRegistration[]) =>
	new TextEncoder().encode(JSON.stringify(visibleToolDefinitions(tools))).length;
