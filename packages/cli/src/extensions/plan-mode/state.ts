import { ExtensionStartupError } from "../../core/extensions/startup-error.ts";
import type { SessionEntry } from "../../core/session-manager.ts";

export interface PlanSnapshot {
	mode: "off" | "planning";
	draft?: { revision: number; markdown: string };
	approved?: number;
}

export type PlanTransition = { type: "enter" | "exit" | "approve" } | { type: "submit"; markdown: string };

/** Snapshots follow the selected branch, including entries omitted by compaction. */
export function foldPlanState(entries: readonly SessionEntry[]): PlanSnapshot {
	const entry = entries.findLast((e) => e.type === "custom" && e.customType === "plan-mode");
	if (!entry || entry.type !== "custom") return { mode: "off" };
	const value = entry.data as Partial<PlanSnapshot> | null;
	if (
		!value ||
		(value.mode !== "off" && value.mode !== "planning") ||
		(value.draft !== undefined &&
			(!Number.isSafeInteger(value.draft?.revision) ||
				value.draft.revision < 1 ||
				typeof value.draft.markdown !== "string" ||
				!value.draft.markdown.trim())) ||
		(value.approved !== undefined && (value.mode !== "off" || value.approved !== value.draft?.revision))
	) {
		throw new ExtensionStartupError(
			"Invalid saved plan-mode snapshot; navigate to a valid branch or start a new session.",
		);
	}
	return value as PlanSnapshot;
}

export function transitionPlan(state: PlanSnapshot, event: PlanTransition): PlanSnapshot {
	switch (event.type) {
		case "enter":
			return { mode: "planning", ...(state.draft ? { draft: state.draft } : {}) };
		case "submit":
			if (state.mode !== "planning" || !event.markdown.trim())
				throw new Error("A non-empty plan in plan mode is required.");
			return { mode: "planning", draft: { revision: (state.draft?.revision ?? 0) + 1, markdown: event.markdown } };
		case "approve":
			if (state.mode !== "planning" || !state.draft) throw new Error("No plan to approve.");
			return { ...state, mode: "off", approved: state.draft.revision };
		case "exit":
			return { ...state, mode: "off" };
	}
}
