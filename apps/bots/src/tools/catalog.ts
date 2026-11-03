// The bot's tools as one durable extension, "bots-core" (spec section 5): a short core list the model always sees,
// everything else deferred behind tool_search (connectors and skills join that set in Part 3). Its prompt sections
// carry the owner's instructions first (stable), then the knowledge files, and the memory index with open work last.
// A beforeRequest hook shortens old exchanges by rule before any paid summary (spec section 6). Outside text (web
// pages here; email, webhooks and other bots in Part 3) marks the run, and a marked run's notes are labelled and its
// settings changes refused (spec section 24).
import type { FileRef } from "@knightcode/bots-protocol";
import { defineExtension, defineTool, type Extension, GenerationTask, hook, section, type ToolRegistration } from "@knightcode/durable";
import { createToolSearchExtension } from "@knightcode/durable/tool-search";
import { createBashTool, createEditTool, createReadTool, createWriteTool } from "@knightcode/durable/tools";
import { type Gate, githubCommentTool, sendEmailTool } from "../bot/action-tools.ts";
import { type ComputerAccess, computerTools } from "../computer/browser-tools.ts";
import { lit, obj, opt, str, union } from "@knightcode/schema";
import { shortenOldMessages } from "../memory/context-rules.ts";
import { historyTools } from "../memory/history-tools.ts";
import { memoryText } from "../memory/index-file.ts";
import type { BotMemory } from "../memory/memory.ts";
import { type HelpDocs, helpTool } from "./help-skill.ts";
import { imageTool } from "./image-tool.ts";
import { type BotSettings, type SettingsStore, type UpdateRules, updateBotTool } from "./settings-tool.ts";
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
	/** Runs after update_bot changes a setting. */
	settingsChanged?: (settings: BotSettings, before: BotSettings) => Promise<void>;
	/** Each model response, for the usage page (provider usage reports). */
	/** Undefined when this run may use the computer now; otherwise what the tool answers instead (it asked, or refused). */
	computerAllowed?: () => Promise<string | undefined>;
	onResponse?: (message: { provider?: string; model?: string; usage?: { input?: number; output?: number; cost?: { total?: number } } }) => void;
	/** What chat may change right now: the outside mark and the user's models. */
	settingsRules?: () => UpdateRules;
	/** More of the bot's tools: messaging other bots, helpers, and (for a manager) the management tools. */
	extraTools?: ToolRegistration[];
	/** Decides and records outward actions (send_email and, with Part 3's channels and connectors, the rest). */
	gate?: Gate;
	/** Outside-text provenance of the current run. */
	provenance?: { outside(): boolean; enter(source: "web"): Promise<void> };
	/** Present only when the owner gave this bot computer access. */
	computer?: ComputerAccess;
}

const KNOWLEDGE_MAX = 50_000;
const text = (value: string, isError = false) => ({ output: [{ type: "text" as const, text: value }], ...(isError ? { isError } : {}) });

function memoryTools(memory: BotMemory, outside: () => boolean) {
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
			// A note written while outside text is in play is labelled, and needs approval to be shared.
			execute: async (args) => text(`Saved ${(await memory.notes.write({ ...args, outside: outside() })).name}.`),
		}),
	];
}

function knowledgeTool(knowledge: Knowledge) {
	return defineTool({
		name: "read_knowledge",
		description: "Read one of your knowledge files by name.",
		// The files are listed in the prompt; the reader loads through tool_search when needed.
		deferred: true,
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
		updateBotTool(deps.settings, deps.settingsChanged, () => deps.settingsRules?.() ?? {}),
		...memoryTools(deps.memory, () => deps.provenance?.outside() ?? false),
		...historyTools(deps.memory.history),
		knowledgeTool(deps.knowledge),
		...webTools(() => deps.provenance?.enter("web") ?? Promise.resolve()),
		...(deps.gate ? [sendEmailTool(deps.gate), githubCommentTool(deps.gate)] : []),
		...(deps.extraTools ?? []),
		helpTool(deps.help),
		...(deps.image && deps.image.available.length > 0 ? [imageTool(deps.image)] : []),
		// Shell and files run on the bot's computer (the harness's env), the browser and desktop through the bridge.
		...(deps.computer
			? [
					createBashTool(),
					createReadTool(),
					createWriteTool(),
					// The largest definition; bots that edit code load it through tool_search.
					{ ...createEditTool(), deferred: true as const },
					...computerTools(deps.computer),
				].map((tool) => guardComputerTool(tool as ToolRegistration, deps.computerAllowed))
			: []),
	] as ToolRegistration[];
}

/**
 * A computer tool that runs only while `allowed` says so: in a run outside text started or entered, the computer is used
 * within the run's grant (computer.use) or once the owner allows it; otherwise the tool answers with `allowed`'s text.
 */
export function guardComputerTool(tool: ToolRegistration, allowed: (() => Promise<string | undefined>) | undefined): ToolRegistration {
	if (!allowed) return tool;
	const execute = tool.execute as (...args: unknown[]) => unknown;
	return {
		...tool,
		execute: (async (...args: unknown[]) => {
			const instead = await allowed();
			return instead === undefined ? execute(...args) : { output: [{ type: "text", text: instead }], isError: true };
		}) as ToolRegistration["execute"],
	} as ToolRegistration;
}

/** The bot's extensions: its own tools and sections, and tool search over the deferred ones. */
export function botExtensions(deps: BotToolDeps): { core: Extension; toolSearch: Extension } {
	return {
		core: defineExtension({
			name: "bots-core",
			tools: botTools(deps),
			hooks: [
				hook(GenerationTask, {
					beforeRequest: (request) => ({ messages: shortenOldMessages(request.messages) }),
					afterResponse: (message) => deps.onResponse?.(message),
				}),
			],
			sections: [
				// First and stable: the owner's instructions, as the bot's settings hold them now.
				section("bot", () => {
					const settings = deps.settings.read();
					const lines = [
						`You are ${settings.name}${settings.purpose ? `, ${settings.purpose}` : ""}.`,
						...(settings.instructions ? ["", settings.instructions] : []),
					];
					return lines.join("\n");
				}),
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
