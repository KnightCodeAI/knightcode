import type { CommittedListAppendWrite, CommittedValueSetWrite } from "./commit.ts";

export type ForkCurrentStatePlan =
	{ scope: "branch"; branch: string; destinationTip: string | null } | { scope: "tree" };

/** Project one current scalar row or surviving list element into destination state. */
export function projectForkCurrentStateWrite(
	write: CommittedValueSetWrite | CommittedListAppendWrite,
	plan: ForkCurrentStatePlan,
	isEntryCopied: (entryId: string) => boolean,
): CommittedValueSetWrite | CommittedListAppendWrite | undefined {
	switch (write.namespace) {
		case "knightcode.session.name":
			return write;
		case "knightcode.entry.label":
			return isEntryCopied(write.key) ? write : undefined;
		case "knightcode.branch.tip":
			if (plan.scope === "tree") return write;
			return write.key === plan.branch ? { ...write, value: plan.destinationTip } : undefined;
		case "knightcode.lane.config":
			return plan.scope === "tree" || write.key === plan.branch ? write : undefined;
		case "knightcode.lane.state":
			return plan.scope === "tree" || write.key === plan.branch
				? { ...write, value: { currentOperationId: null, lastOperationId: null, inbox: [] } }
				: undefined;
		case "knightcode.result":
			return undefined;
	}
	if (write.namespace.startsWith("knightcode.op.") || write.namespace.startsWith("knightcode.pending."))
		return undefined;
	if (write.namespace === "knightcode" || write.namespace.startsWith("knightcode.")) {
		throw new Error(`Unknown reserved fork namespace: ${write.namespace}`);
	}
	return plan.scope === "tree" ? write : undefined;
}
