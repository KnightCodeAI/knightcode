import type { ExtensionAPI } from "../../../src/index.ts";

export interface Gate {
	extension: (knightcode: ExtensionAPI) => Promise<void>;
	/** Resolves when a load reaches the gate: the load is provably in flight. */
	entered: Promise<void>;
	open(): void;
	/** "session_shutdown" for every session of a thread that loaded this extension; tests add their own marks. */
	events: string[];
}

/**
 * An extension whose factory waits until the test opens the gate, so a load can be caught in flight.
 * `skip` lets that many loads through first (a replacement's target is the second load).
 */
export function createGate(skip = 0): Gate {
	let open!: () => void;
	let entered!: () => void;
	const opened = new Promise<void>((resolve) => {
		open = resolve;
	});
	const enteredPromise = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const events: string[] = [];
	return {
		extension: async (knightcode) => {
			knightcode.on("session_shutdown", () => {
				events.push("session_shutdown");
			});
			if (skip-- > 0) return;
			entered();
			await opened;
		},
		entered: enteredPromise,
		open,
		events,
	};
}
