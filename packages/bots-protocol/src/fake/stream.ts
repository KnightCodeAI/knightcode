// The fake backend's clock and its word-by-word reply streaming, so tests and screenshots are deterministic.

/** Time for the fake. Tests drive a manual clock; the dev web app uses a realtime one. */
export interface FakeClock {
	now(): number;
	setTimeout(task: () => void, ms: number): number;
	clearTimeout(id: number): void;
	/** Advances virtual time by `ms`, running every task due on the way. */
	advance(ms: number): Promise<void>;
	/** Runs every pending task, including ones scheduled while running, until none remain. */
	runAll(): Promise<void>;
}

/** 16:00 UTC on 1 November 2026: every seed timestamp is relative to it. */
export const FAKE_EPOCH = Date.UTC(2026, 10, 1, 16, 0, 0);

type Pending = { id: number; at: number; task: () => void; timer?: ReturnType<typeof setTimeout> };

/** A clock that only moves when told to. */
export function manualClock(start = FAKE_EPOCH): FakeClock {
	return createClock(start, false);
}

/** A clock that also fires tasks on real timers, starting at the fake epoch so relative times stay stable. */
export function realtimeClock(start = FAKE_EPOCH): FakeClock {
	return createClock(start, true);
}

function createClock(start: number, realtime: boolean): FakeClock {
	let virtual = start;
	const origin = Date.now();
	let nextId = 1;
	const pending = new Map<number, Pending>();
	const now = () => (realtime ? Math.max(virtual, start + (Date.now() - origin)) : virtual);
	const run = (entry: Pending) => {
		if (!pending.delete(entry.id)) return;
		if (entry.timer !== undefined) clearTimeout(entry.timer);
		virtual = Math.max(virtual, entry.at);
		entry.task();
	};
	const due = (limit: number) =>
		[...pending.values()].filter((entry) => entry.at <= limit).sort((a, b) => a.at - b.at || a.id - b.id)[0];
	const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));
	return {
		now,
		setTimeout(task, ms) {
			const entry: Pending = { id: nextId++, at: now() + Math.max(0, ms), task };
			if (realtime) entry.timer = setTimeout(() => run(entry), Math.max(0, ms));
			pending.set(entry.id, entry);
			return entry.id;
		},
		clearTimeout(id) {
			const entry = pending.get(id);
			if (entry?.timer !== undefined) clearTimeout(entry.timer);
			pending.delete(id);
		},
		async advance(ms) {
			const limit = now() + ms;
			for (let entry = due(limit); entry; entry = due(limit)) {
				run(entry);
				await settle();
			}
			virtual = Math.max(virtual, limit);
		},
		async runAll() {
			await settle();
			for (let entry = due(Number.POSITIVE_INFINITY); entry; entry = due(Number.POSITIVE_INFINITY)) {
				run(entry);
				await settle();
			}
		},
	};
}

/** Milliseconds between streamed words. */
export const WORD_MS = 40;

/** A reply being streamed; `stop` ends it early and keeps what was already sent. */
export interface ReplyStream {
	stop(): void;
}

/**
 * Streams `text` word by word: `onChunk` receives each piece (with its leading space), then `onDone` runs once,
 * whether the reply finished or was stopped.
 */
export function streamWords(
	clock: FakeClock,
	text: string,
	onChunk: (chunk: string) => void,
	onDone: () => void,
): ReplyStream {
	const words = text.match(/\s*\S+/g) ?? [];
	let index = 0;
	let timer: number | undefined;
	let done = false;
	const finish = () => {
		if (done) return;
		done = true;
		if (timer !== undefined) clock.clearTimeout(timer);
		onDone();
	};
	const tick = () => {
		timer = undefined;
		if (index < words.length) onChunk(words[index++]!);
		if (index < words.length) timer = clock.setTimeout(tick, WORD_MS);
		else finish();
	};
	timer = clock.setTimeout(tick, WORD_MS);
	return { stop: finish };
}
