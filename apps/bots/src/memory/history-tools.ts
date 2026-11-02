// search_history and read_history (spec section 6): old messages stay reachable after they leave the prompt. Results
// are bounded excerpts with stable references ("<botId>:<entryId>"), newest first so later corrections come before what
// they corrected. Every read checks that the reference is this bot's own message: a model-supplied id is not
// authorization.
import type { Conversation, EntryId, EntryRecord } from "@knightcode/durable";
import { AssistantEntry, defineTool, UserEntry } from "@knightcode/durable";
import { BACKGROUND_CONTEXT } from "@knightcode/chord/context";
import { num, obj, opt, str } from "@knightcode/schema";

const context = BACKGROUND_CONTEXT;
const SEARCH_LIMIT = 10;
const EXCERPT = 300;
const READ_AROUND = 10;
const READ_MAX_CHARS = 2_000;
const PAGE = 500;

export interface HistoryHit {
	ref: string;
	role: "user" | "assistant";
	at: number;
	excerpt: string;
}

export class NotFound extends Error {
	constructor() {
		super("not found");
		this.name = "NotFound";
	}
}

type Message = { role?: string; content?: unknown; timestamp?: number };

function messageText(entry: EntryRecord): { role: "user" | "assistant"; text: string; at: number } | undefined {
	if (entry.kind !== UserEntry.kind && entry.kind !== AssistantEntry.kind) return undefined;
	const message = entry.model?.[0] as Message | undefined;
	if (!message) return undefined;
	const text =
		typeof message.content === "string"
			? message.content
			: Array.isArray(message.content)
				? message.content
						.filter((block): block is { type: "text"; text: string } => block?.type === "text")
						.map((block) => block.text)
						.join("")
				: "";
	return { role: entry.kind === UserEntry.kind ? "user" : "assistant", text, at: message.timestamp ?? 0 };
}

function excerpt(text: string, words: string[]): string {
	if (text.length <= EXCERPT) return text;
	const lower = text.toLowerCase();
	const at = Math.max(0, Math.min(...words.map((word) => lower.indexOf(word)).filter((index) => index >= 0), text.length));
	const start = Math.max(0, Math.min(at - EXCERPT / 3, text.length - EXCERPT));
	return `${start > 0 ? "…" : ""}${text.slice(start, start + EXCERPT)}${start + EXCERPT < text.length ? "…" : ""}`;
}

/** A keyword index over one bot's messages, filled lazily from the transcript. */
export class HistoryIndex {
	readonly #sql: SqlStorage;
	readonly #botId: string;
	readonly #conversation: () => Promise<Conversation>;

	constructor(sql: SqlStorage, botId: string, conversation: () => Promise<Conversation>) {
		this.#sql = sql;
		this.#botId = botId;
		this.#conversation = conversation;
		sql.exec("CREATE VIRTUAL TABLE IF NOT EXISTS history_fts USING fts5(entry UNINDEXED, role UNINDEXED, at UNINDEXED, text)");
		sql.exec("CREATE TABLE IF NOT EXISTS history_meta (id INTEGER PRIMARY KEY CHECK (id = 1), indexed INTEGER NOT NULL)");
	}

	/** Indexes messages committed since the last call. */
	async sync(): Promise<void> {
		const root = await this.#conversation();
		let last = this.#sql.exec<{ indexed: number }>("SELECT indexed FROM history_meta WHERE id = 1").toArray()[0]?.indexed ?? -1;
		for (;;) {
			const page = await root.entries({ minEntryId: (last + 1) as EntryId, order: "ascending" }, PAGE, undefined, context);
			if (page.items.length === 0) return;
			for (const entry of page.items) {
				const message = messageText(entry);
				if (message?.text)
					this.#sql.exec(
						"INSERT INTO history_fts (entry, role, at, text) VALUES (?, ?, ?, ?)",
						Number(entry.id),
						message.role,
						message.at,
						message.text,
					);
				last = Number(entry.id);
			}
			this.#sql.exec("INSERT INTO history_meta (id, indexed) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET indexed = excluded.indexed", last);
			if (page.items.length < PAGE) return;
		}
	}

	async search(args: { query: string; from?: number; to?: number; cursor?: string }): Promise<{ hits: HistoryHit[]; next?: string }> {
		await this.sync();
		const words = args.query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
		if (words.length === 0) return { hits: [] };
		const offset = Math.max(0, Number(args.cursor ?? 0) || 0);
		const rows = this.#sql
			.exec<{ entry: number; role: "user" | "assistant"; at: number; text: string }>(
				`SELECT entry, role, at, text FROM history_fts WHERE history_fts MATCH ? AND at >= ? AND at <= ?
				 ORDER BY entry DESC LIMIT ? OFFSET ?`,
				[...new Set(words)].map((word) => `"${word}"`).join(" OR "),
				args.from ?? 0,
				args.to ?? Number.MAX_SAFE_INTEGER,
				SEARCH_LIMIT + 1,
				offset,
			)
			.toArray();
		const hits = rows.slice(0, SEARCH_LIMIT).map((row) => ({
			ref: `${this.#botId}:${row.entry}`,
			role: row.role,
			at: row.at,
			excerpt: excerpt(row.text, words),
		}));
		return rows.length > SEARCH_LIMIT ? { hits, next: String(offset + SEARCH_LIMIT) } : { hits };
	}

	/** The message `ref` names and up to 10 on either side, each bounded; "not found" for anything not this bot's. */
	async read(args: { ref: string; before?: number; after?: number }): Promise<{ messages: (HistoryHit & { text: string })[] }> {
		const match = /^(.+):(\d+)$/.exec(args.ref);
		if (!match || match[1] !== this.#botId) throw new NotFound();
		const id = Number(match[2]);
		const root = await this.#conversation();
		const target = await root.entries({ minEntryId: id as EntryId, maxEntryId: id as EntryId }, 1, undefined, context);
		if (!target.items[0] || !messageText(target.items[0])) throw new NotFound();
		const take = (n: number | undefined) => Math.min(Math.max(0, n ?? 3), READ_AROUND);
		const before = (await root.entries({ maxEntryId: (id - 1) as EntryId }, take(args.before) * 3, undefined, context)).items;
		const after = (
			await root.entries({ minEntryId: (id + 1) as EntryId, order: "ascending" }, take(args.after) * 3, undefined, context)
		).items;
		const messages = [...[...before].reverse(), target.items[0], ...after]
			.map((entry) => ({ entry, message: messageText(entry) }))
			.filter((item): item is { entry: EntryRecord; message: NonNullable<ReturnType<typeof messageText>> } => !!item.message?.text);
		const index = messages.findIndex((item) => Number(item.entry.id) === id);
		return {
			messages: messages.slice(Math.max(0, index - take(args.before)), index + take(args.after) + 1).map(({ entry, message }) => ({
				ref: `${this.#botId}:${Number(entry.id)}`,
				role: message.role,
				at: message.at,
				excerpt: message.text.slice(0, EXCERPT),
				text: message.text.slice(0, READ_MAX_CHARS),
			})),
		};
	}
}

const asOutput = (value: unknown) => ({ output: [{ type: "text" as const, text: JSON.stringify(value) }] });

/** The two history tools over `history`. */
export function historyTools(history: HistoryIndex) {
	return [
		defineTool({
			name: "search_history",
			description:
				"Search this chat's older messages by keywords. Returns short excerpts with refs, newest first, so later corrections come first. Check them before saying you remember something.",
			parameters: obj({
				query: str(),
				from: opt(num({ description: "Earliest time, epoch milliseconds" })),
				to: opt(num({ description: "Latest time, epoch milliseconds" })),
				cursor: opt(str()),
			}),
			execute: async (args) => asOutput(await history.search(args)),
		}),
		defineTool({
			name: "read_history",
			description: "Read the message a search_history ref points to, with a few messages around it.",
			parameters: obj({
				ref: str(),
				before: opt(num({ description: "Messages before it, at most 10" })),
				after: opt(num({ description: "Messages after it, at most 10" })),
				cursor: opt(str()),
			}),
			execute: async (args) => {
				try {
					return asOutput(await history.read(args));
				} catch (error) {
					if (error instanceof NotFound) return { output: [{ type: "text" as const, text: "not found" }], isError: true };
					throw error;
				}
			},
		}),
	];
}
