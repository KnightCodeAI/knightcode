import { Type } from "typebox";
import type { ExtensionAPI } from "../../../src/index.ts";

export interface HeldTurn {
	extension: (knightcode: ExtensionAPI) => void;
	/** Resolves when the tool has started; the turn is provably running. */
	entered: Promise<void>;
	release(): void;
}

/** A test-controlled turn that also finishes on abort, so failed assertions cannot hang cleanup. */
export function createHeldTurn(): HeldTurn {
	let release!: () => void;
	let entered!: () => void;
	const released = new Promise<void>((resolve) => (release = resolve));
	const enteredPromise = new Promise<void>((resolve) => (entered = resolve));
	return {
		extension: (knightcode) => {
			knightcode.registerTool({
				name: "hold",
				label: "Hold",
				description: "Blocks until the test releases it.",
				parameters: Type.Object({}),
				execute: async (_toolCallId, _params, signal) => {
					entered();
					let onAbort!: () => void;
					const aborted = new Promise<void>((resolve) => {
						onAbort = resolve;
						if (signal?.aborted) resolve();
						else signal?.addEventListener("abort", onAbort, { once: true });
					});
					try {
						await Promise.race([released, aborted]);
					} finally {
						signal?.removeEventListener("abort", onAbort);
					}
					return { content: [{ type: "text", text: signal?.aborted ? "aborted" : "released" }], details: {} };
				},
			});
		},
		entered: enteredPromise,
		release,
	};
}
