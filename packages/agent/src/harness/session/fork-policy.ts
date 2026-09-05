/**
 * Final action for current state at one address:
 * - copy: emit the current value in the destination;
 * - exclude: omit it from the destination;
 * - reconstruct: do not copy the row because lane handling emits a coherent replacement.
 */
export type ForkDisposition = "copy" | "exclude" | "reconstruct";

/** Decide the final fork action for one current scalar or list address. */
export function classifyForkAddress(
	address: { readonly namespace: string; readonly key: string },
	scope: "branch" | "tree",
	isEntryCopied: (entryId: string) => boolean,
): ForkDisposition {
	switch (address.namespace) {
		case "knightcode.session.name":
			return "copy";
		case "knightcode.entry.label":
			return isEntryCopied(address.key) ? "copy" : "exclude";
		case "knightcode.branch.tip":
		case "knightcode.lane.config":
		case "knightcode.lane.state":
			return "reconstruct";
		case "knightcode.result":
			return "exclude";
	}
	if (address.namespace.startsWith("knightcode.op.") || address.namespace.startsWith("knightcode.pending."))
		return "exclude";
	if (address.namespace === "knightcode" || address.namespace.startsWith("knightcode.")) {
		throw new Error(`Unknown reserved fork namespace: ${address.namespace}`);
	}
	return scope === "tree" ? "copy" : "exclude";
}
