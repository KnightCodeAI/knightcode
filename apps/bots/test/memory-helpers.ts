// Shared helpers for the memory tests: reaching a bot's memory, seeding its transcript, and a fake embedder.
import { BACKGROUND_CONTEXT } from "@knightcode/chord/context";
import { AssistantEntry, UserEntry } from "@knightcode/durable";
import { env, runInDurableObject } from "cloudflare:test";
import type { Principal } from "../src/auth/session.ts";
import type { BotObject } from "../src/bot/bot-object.ts";
import { historyTools } from "../src/memory/history-tools.ts";
import type { BotMemory } from "../src/memory/memory.ts";
import type { Embedder } from "../src/memory/search.ts";

export const context = BACKGROUND_CONTEXT;
export const principal: Principal = { accountId: "acct-a", workspaceId: "acct-a", client: "web" };

export const botStub = (botId: string) => env.BOT.get(env.BOT.idFromName(botId));

export const claim = (botId: string) => botStub(botId).claim(principal, { provider: "fake", modelId: "fake-model" });

/** Runs `fn` with bot `botId`'s memory and SQLite, inside its object. */
export const withMemory = <T>(botId: string, fn: (memory: BotMemory, sql: SqlStorage) => T | Promise<T>): Promise<T> =>
	runInDurableObject(botStub(botId), (instance, state) => fn((instance as unknown as BotObject).memory, state.storage.sql));

/** Appends `messages` to the bot's transcript as user and assistant entries, 500 per commit. */
export async function seedMessages(botId: string, messages: { role: "user" | "assistant"; text: string; at: number }[]) {
	await withMemory(botId, async (memory) => {
		const root = await memory.conversation();
		for (let start = 0; start < messages.length; start += 500) {
			const batch = messages.slice(start, start + 500);
			await root.commit(async (tx) => {
				for (const message of batch)
					await tx.appendEntry(root.id, {
						kind: message.role === "user" ? UserEntry.kind : AssistantEntry.kind,
						model: [
							message.role === "user"
								? { role: "user", content: message.text, timestamp: message.at }
								: {
										role: "assistant",
										content: [{ type: "text", text: message.text }],
										api: "fake",
										provider: "fake",
										model: "fake-model",
										usage: {
											input: 0,
											output: 0,
											cacheRead: 0,
											cacheWrite: 0,
											totalTokens: 0,
											cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
										},
										stopReason: "stop",
										timestamp: message.at,
									},
						],
					});
			}, context);
		}
	});
}

/** Calls one of the bot's history tools the way the model would; a refused call rejects with its text. */
export async function callTool(botId: string, name: "search_history" | "read_history", args: Record<string, unknown>) {
	return withMemory(botId, async (memory) => {
		const tool = historyTools(memory.history).find((candidate) => candidate.name === name)!;
		const result = await (tool.execute as (args: unknown, api: unknown, ctx: unknown) => Promise<{
			output: { type: "text"; text: string }[];
			isError?: boolean;
		}>)(args, undefined, context);
		const text = result.output.map((block) => block.text).join("");
		if (result.isError) throw new Error(text);
		return JSON.parse(text) as unknown;
	});
}

/**
 * A stand-in embedding model: words in the same group point the same way, so a reworded question finds a fact that
 * shares no keyword with it.
 */
const GROUPS = [
	["tea", "brew", "beverage", "drink", "coffee", "sip"],
	["dog", "pet", "puppy", "hound"],
	["database", "postgres", "sqlite", "storage"],
	["dentist", "teeth", "appointment", "checkup"],
];
export const fakeEmbedder: Embedder = {
	model: "fake-embedding",
	embed: async (texts) =>
		texts.map((text) => {
			const vector = new Array<number>(GROUPS.length + 1).fill(0);
			for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
				const group = GROUPS.findIndex((words) => words.includes(word));
				vector[group < 0 ? GROUPS.length : group] += group < 0 ? 0.05 : 1;
			}
			return vector;
		}),
};
