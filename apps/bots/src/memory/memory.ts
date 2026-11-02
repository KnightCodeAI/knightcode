// One bot's memory, as its bot object uses it: notes, open work, history search, and recall before each input.
import type { Conversation } from "@knightcode/durable";
import { BACKGROUND_CONTEXT } from "@knightcode/chord/context";
import { type HostWrite, immediateWrite } from "../bot/host-sql.ts";
import { createDreamTable } from "./dream.ts";
import { HistoryIndex } from "./history-tools.ts";
import { NotesStore } from "./notes.ts";
import { OpenWork } from "./open-work.ts";
import { type Helper, notesInPrompt, RECALL_ENTRY, type RecallData, renderRecalled, selectRecall } from "./recall.ts";
import { type Embedder, searchNotes } from "./search.ts";

const context = BACKGROUND_CONTEXT;
/** How many search hits recall weighs before choosing. */
const CANDIDATES = 20;

let embedderFactory: (accountId: string) => Embedder | undefined = () => undefined;

/**
 * How bots embed text for meaning-based search: the embedding model the user picked. None is picked until the settings
 * route lands, so search is keyword-only by default; tests install a fake.
 */
export function setEmbedderFactory(next: ((accountId: string) => Embedder | undefined) | undefined): void {
	embedderFactory = next ?? (() => undefined);
}

export class BotMemory {
	readonly notes: NotesStore;
	readonly openWork: OpenWork;
	readonly history: HistoryIndex;
	/** Host writes, queued behind the harness's transactions. */
	readonly write: HostWrite;
	/** The bot's conversation. */
	readonly conversation: () => Promise<Conversation>;
	readonly #owner: () => string | undefined;
	readonly #helper: () => Helper | undefined;

	constructor(input: {
		sql: SqlStorage;
		botId: string;
		conversation: () => Promise<Conversation>;
		owner: () => string | undefined;
		helper: () => Helper | undefined;
		write?: HostWrite;
	}) {
		const write = input.write ?? immediateWrite(input.sql);
		this.write = write;
		this.notes = new NotesStore(input.sql, write);
		this.openWork = new OpenWork(input.sql, write);
		this.history = new HistoryIndex(input.sql, input.botId, input.conversation, write);
		createDreamTable(input.sql);
		this.conversation = input.conversation;
		this.#owner = input.owner;
		this.#helper = input.helper;
	}

	#embedder(): Embedder | undefined {
		const owner = this.#owner();
		return owner ? embedderFactory(owner) : undefined;
	}

	/**
	 * Picks the notes relevant to `message` that the prompt does not already hold, and writes them into the transcript
	 * ahead of the message (once per `requestId`). Returns their names.
	 */
	async recall(message: string, requestId = crypto.randomUUID()): Promise<string[]> {
		const root = await this.conversation();
		const candidates = await searchNotes(this.notes, message, { limit: CANDIDATES, embedder: this.#embedder() });
		if (candidates.length === 0) return [];
		const inPrompt = notesInPrompt(await root.context(context));
		const names = await selectRecall({ message, candidates, inPrompt, helper: this.#helper() });
		const notes = names.flatMap((name) => this.notes.get(name) ?? []);
		if (notes.length === 0) return [];
		const data: RecallData = { notes: notes.map((note) => ({ name: note.name, version: note.version })) };
		await root.submit(
			{
				type: "write",
				requestId: `recall:${requestId}`,
				entry: {
					kind: RECALL_ENTRY,
					model: [{ role: "user", content: renderRecalled(notes), timestamp: Date.now() }],
					data,
				},
			},
			context,
		);
		return notes.map((note) => note.name);
	}
}
