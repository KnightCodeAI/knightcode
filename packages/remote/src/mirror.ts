import { sanitiseEntries } from "./entries.ts";
import { frameByteLength, type HostFrame, MAX_FRAME_BYTES, MAX_ROOM_BYTES, type RemoteCommand } from "./protocol.ts";

/** The narrow slice of the session the mirror reads. Deliberately excludes any lifetime control. */
export interface MirrorSource {
	readonly cwd: string;
	readonly model?: string;
	getEntries(): unknown[];
	getLeafId(): string | null;
	getSessionName(): string | undefined;
	/** Slash commands a viewer may send. Read at snapshot time only; the list rarely changes. */
	getCommands?(): RemoteCommand[];
}

/**
 * Entries per frame are capped at half the relay's frame limit. A single entry can already
 * be that large (see entries.ts), and the relay drops an oversized frame without a word,
 * which showed up as a long session that never rendered at all.
 */
export const CHUNK_BYTES = MAX_FRAME_BYTES / 2;

/**
 * A snapshot carries only the newest entries that fit in half the relay's room limit. The
 * relay asks for a fresh snapshot once a room passes MAX_ROOM_BYTES, so a snapshot already
 * past that limit tripped the request again at once and re-uploaded the whole transcript at
 * every settle point. The other half is the room's headroom before the next one.
 */
export const SNAPSHOT_BYTES = MAX_ROOM_BYTES / 2;

function chunk(entries: unknown[], cap: number): unknown[][] {
	const chunks: unknown[][] = [];
	let current: unknown[] = [];
	let bytes = 0;
	for (const entry of entries) {
		const size = frameByteLength(JSON.stringify(entry) ?? "");
		if (current.length > 0 && bytes + size > cap) {
			chunks.push(current);
			current = [];
			bytes = 0;
		}
		current.push(entry);
		bytes += size;
	}
	chunks.push(current);
	return chunks;
}

function newest(entries: unknown[], budget: number): unknown[] {
	let start = entries.length;
	let bytes = 0;
	while (start > 0) {
		const size = frameByteLength(JSON.stringify(entries[start - 1]) ?? "");
		if (bytes + size > budget) break;
		bytes += size;
		start -= 1;
	}
	return entries.slice(start);
}

export class Mirror {
	#lastCount = 0;
	#stale = true;
	readonly #chunkBytes: number;
	readonly #snapshotBytes: number;

	constructor(chunkBytes = CHUNK_BYTES, snapshotBytes = SNAPSHOT_BYTES) {
		this.#chunkBytes = chunkBytes;
		this.#snapshotBytes = snapshotBytes;
	}

	isStale(): boolean {
		return this.#stale;
	}

	/** Session switches, forks and tree moves invalidate entry counting; the next drain re-snapshots. */
	markStale(): void {
		this.#stale = true;
	}

	/**
	 * Called only at settle points. getEntries() allocates a filtered copy of every file entry,
	 * so it must never run on message_update, which fires at token rate.
	 */
	drain(source: MirrorSource): HostFrame[] {
		const entries = source.getEntries();
		// A shorter log means the branch changed under us. Counting cannot describe that, and
		// treating it as "nothing new" would freeze the viewer on a transcript that is gone.
		if (this.#stale || entries.length < this.#lastCount) {
			this.#stale = false;
			this.#lastCount = entries.length;
			const kept = newest(sanitiseEntries(entries), this.#snapshotBytes);
			const [first = [], ...rest] = chunk(kept, this.#chunkBytes);
			return [
				{
					v: 1,
					type: "snapshot",
					cwd: source.cwd,
					leafId: source.getLeafId(),
					entries: first,
					sessionName: source.getSessionName(),
					model: source.model,
					commands: source.getCommands?.(),
				},
				...rest.map((batch): HostFrame => ({ v: 1, type: "entries", entries: batch })),
			];
		}
		if (entries.length === this.#lastCount) return [];
		const added = entries.slice(this.#lastCount);
		this.#lastCount = entries.length;
		return chunk(sanitiseEntries(added), this.#chunkBytes).map((batch): HostFrame => ({
			v: 1,
			type: "entries",
			entries: batch,
		}));
	}

	stream(messageId: string, content: string, thinking?: string): HostFrame {
		return { v: 1, type: "stream", messageId, content, thinking };
	}

	/** Snapshot of liveness for the browser's composer and stop button. Cheap; reads no entries. */
	status(idle: boolean, streaming: boolean, model?: string, contextTokens?: number): HostFrame {
		return { v: 1, type: "status", idle, streaming, model, contextTokens };
	}
}
