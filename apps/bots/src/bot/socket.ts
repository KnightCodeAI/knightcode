// A bot's live view for its sockets (spec section 6): durable's conversation view projected into the protocol's
// ConversationView, numbered by version. Durable's view is a sliding window; a ConversationTranscript merges every
// window into the whole transcript this instance has seen, so messages never drop out of a client's view while it
// watches (older ones are paged through the history route, flagged by hasEarlier), with the ops between versions kept so a client that drops resumes with what
// it missed: no gap and no repeated text. Versions start at the instance's start time, so a version a client holds
// from an earlier instance is never mistaken for one of this instance's; that client gets a full view instead.
import type { Op } from "@knightcode/chord/delta";
import { diffRevisions } from "@knightcode/chord/delta";
import type { ConversationView as ProtocolView, Entry } from "@knightcode/bots-protocol";
import {
	AssistantEntry,
	ConversationTranscript,
	type ConversationView,
	type EntryRecord,
	type LiveState,
	UserEntry,
} from "@knightcode/durable";

type Message = { role: string; content: unknown; timestamp?: number };

const textOf = (message: Message): string =>
	typeof message.content === "string"
		? message.content
		: Array.isArray(message.content)
			? message.content
					.filter((block): block is { type: "text"; text: string } => block?.type === "text")
					.map((block) => block.text)
					.join("")
			: "";

/** What the host adds beside the transcript: cards, seeded history and other rows, and the user's reactions. */
export interface ViewExtras {
	entries: Entry[];
	reactions: Record<string, { emoji: string; count: number; mine: boolean }[]>;
}

const NO_EXTRAS: ViewExtras = { entries: [], reactions: {} };

/**
 * The protocol's view: the transcript's user and assistant messages (with their reactions) and the host's entries, in
 * time order; then the streaming answer, and whether a run is going. `entries` defaults to the view's own window.
 */
export function project(
	view: ConversationView,
	all: readonly EntryRecord[] = view.entries,
	earlier = view.before !== undefined,
	extras: ViewExtras = NO_EXTRAS,
): ProtocolView {
	const entries: Entry[] = [];
	for (const entry of all) {
		if (entry.kind !== UserEntry.kind && entry.kind !== AssistantEntry.kind) continue;
		const message = entry.model?.[0] as Message | undefined;
		if (!message) continue;
		entries.push({
			kind: "message",
			id: String(entry.id),
			role: entry.kind === UserEntry.kind ? "user" : "assistant",
			text: textOf(message),
			createdAt: message.timestamp ?? 0,
			...(extras.reactions[String(entry.id)]?.length ? { reactions: extras.reactions[String(entry.id)] } : {}),
		});
	}
	if (extras.entries.length > 0) {
		const withReactions = extras.entries.map((entry) =>
			entry.kind === "message" && extras.reactions[entry.id]?.length ? { ...entry, reactions: extras.reactions[entry.id] } : entry,
		);
		// Stable: transcript order is kept among equal times, host entries after them.
		const merged = [...entries.map((entry, index) => ({ entry, index })), ...withReactions.map((entry, index) => ({ entry, index: entries.length + index }))];
		merged.sort((a, b) => a.entry.createdAt - b.entry.createdAt || a.index - b.index);
		entries.splice(0, entries.length, ...merged.map((item) => item.entry));
	}
	const live = view.docs["knightcode.live"] as LiveState | undefined;
	const partial = live?.generation?.message as Message | undefined;
	if (partial && textOf(partial))
		entries.push({
			kind: "message",
			id: "streaming",
			role: "assistant",
			text: textOf(partial),
			createdAt: partial.timestamp ?? 0,
			streaming: true,
		});
	return { entries, running: live?.run !== undefined, hasEarlier: earlier };
}

const LOG_LIMIT = 500;

export type Delivery = { type: "view"; version: number; view: ProtocolView } | { type: "ops"; version: number; ops: Op[] };

export class LiveView {
	version = Date.now();
	view: ProtocolView = { entries: [], running: false, hasEarlier: false };
	readonly #log: { version: number; ops: Op[] }[] = [];
	readonly #transcript: ConversationTranscript;
	readonly #extras: () => ViewExtras;
	#last: { next: ConversationView; entries: EntryRecord[]; earlier: boolean } | undefined;

	/** `load` pages earlier entries (the conversation's `entries`), for the transcript's gaps; `extras` is read each time. */
	constructor(load: ConstructorParameters<typeof ConversationTranscript>[0], extras: () => ViewExtras = () => NO_EXTRAS) {
		this.#transcript = new ConversationTranscript(load);
		this.#extras = extras;
	}

	/** Takes the next durable view; returns the ops to send, or undefined when nothing visible changed. */
	update(next: ConversationView): Delivery | undefined {
		const merged = this.#transcript.merge(next);
		const entries = merged.items.flatMap((item) => (item.kind === "entry" ? [item.entry] : []));
		this.#last = { next, entries, earlier: merged.items[0]?.kind === "earlier" };
		return this.#publish();
	}

	/** Projects again after the host's entries or reactions changed (a card answered, say). */
	refresh(): Delivery | undefined {
		return this.#last ? this.#publish() : undefined;
	}

	#publish(): Delivery | undefined {
		const { next, entries, earlier } = this.#last!;
		const projected = project(next, entries, earlier, this.#extras());
		const ops = diffRevisions(this.view, projected);
		this.view = projected;
		if (ops.length === 0) return undefined;
		this.version += 1;
		this.#log.push({ version: this.version, ops });
		if (this.#log.length > LOG_LIMIT) this.#log.shift();
		return { type: "ops", version: this.version, ops };
	}

	/** What a subscriber holding `since` needs: nothing, the ops it missed, or the whole view. */
	catchUp(since: number | undefined): Delivery[] {
		if (since === this.version) return [];
		if (since !== undefined && since < this.version) {
			const missed = this.#log.filter((entry) => entry.version > since);
			if (missed.length === this.version - since)
				return missed.map((entry) => ({ type: "ops", version: entry.version, ops: entry.ops }));
		}
		return [{ type: "view", version: this.version, view: this.view }];
	}
}
