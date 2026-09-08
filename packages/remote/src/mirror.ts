import { sanitiseEntries } from "./entries.ts";
import type { HostFrame, RemoteCommand } from "./protocol.ts";

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

export class Mirror {
	#lastCount = 0;
	#stale = true;

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
			return [
				{
					v: 1,
					type: "snapshot",
					cwd: source.cwd,
					leafId: source.getLeafId(),
					entries: sanitiseEntries(entries),
					sessionName: source.getSessionName(),
					model: source.model,
					commands: source.getCommands?.(),
				},
			];
		}
		if (entries.length === this.#lastCount) return [];
		const added = entries.slice(this.#lastCount);
		this.#lastCount = entries.length;
		return [{ v: 1, type: "entries", entries: sanitiseEntries(added) }];
	}

	stream(messageId: string, content: string): HostFrame {
		return { v: 1, type: "stream", messageId, content };
	}

	/** Snapshot of liveness for the browser's composer and stop button. Cheap; reads no entries. */
	status(idle: boolean, streaming: boolean, model?: string, contextTokens?: number): HostFrame {
		return { v: 1, type: "status", idle, streaming, model, contextTokens };
	}
}
