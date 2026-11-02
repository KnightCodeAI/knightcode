// Bot-to-bot messages (spec section 11): message_bot sends a request, question, status or result to another of the
// same user's bots, asynchronously. Each message has an id (a retried delivery is dropped), messages are capped at 8,000
// characters, and a chain of bot messages stops after 6 hops, when the bot reports to the user instead. A message
// from a person starts a new chain. A finished request's result goes back automatically unless the bot sent one.
import { defineTool } from "@knightcode/durable";
import { lit, obj, str, union } from "@knightcode/schema";

export const MESSAGE_MAX = 8_000;
export const MAX_HOPS = 6;

export type Intent = "request" | "question" | "status" | "result";

export interface BotMessage {
	id: string;
	fromBot: string;
	fromName: string;
	toBot: string;
	text: string;
	intent: Intent;
	/** 1 for a message a person's run sent; each bot-started run's messages are one more. */
	hop: number;
	/** The message this answers (results). */
	replyTo?: string;
}

export interface Directory {
	/** The same user's other bots, with their "what I'm for" lines. */
	bots(): Promise<{ id: string; name: string; purpose: string }[]>;
}

export type SendResult = { ok: true; id: string } | { ok: false; reason: string };

export interface MessageDeps {
	directory: Directory;
	/** The hop of the current run's chain: 0 in a run a person started. */
	hop(): number;
	send(message: Omit<BotMessage, "id" | "fromBot" | "fromName" | "hop">): Promise<SendResult>;
}

/** The hop a message from this run carries, or the refusal once the chain is at its limit. */
export function nextHop(currentHop: number): { ok: true; hop: number } | { ok: false; reason: string } {
	const hop = currentHop + 1;
	if (hop > MAX_HOPS)
		return {
			ok: false,
			reason: `This chain of bot messages has reached ${MAX_HOPS} hops. Do not message another bot; tell the owner what you have and what is left.`,
		};
	return { ok: true, hop };
}

const text = (value: string, isError = false) => ({ output: [{ type: "text" as const, text: value }], ...(isError ? { isError } : {}) });

export function messageBotTool(deps: MessageDeps) {
	return defineTool({
		name: "message_bot",
		description: "Message another of the owner's bots: request, question, status or result. Replies arrive later.",
		parameters: obj({
			to: str({ description: "The bot's name or id" }),
			text: str(),
			intent: union([lit("request"), lit("question"), lit("status"), lit("result")]),
		}),
		execute: async (args) => {
			if (args.text.length > MESSAGE_MAX) return text(`Keep a bot message under ${MESSAGE_MAX} characters.`, true);
			const hop = nextHop(deps.hop());
			if (!hop.ok) return text(hop.reason, true);
			const bots = await deps.directory.bots();
			const wanted = args.to.trim().toLowerCase();
			const target = bots.find((bot) => bot.id === args.to || bot.name.toLowerCase() === wanted);
			if (!target) return text(`No bot called ${args.to}. Your bots: ${bots.map((bot) => `${bot.name} (${bot.purpose || "no purpose set"})`).join("; ")}.`, true);
			const sent = await deps.send({ toBot: target.id, text: args.text, intent: args.intent });
			return sent.ok ? text(`Sent to ${target.name}. Its reply will come as a message.`) : text(sent.reason, true);
		},
	});
}
