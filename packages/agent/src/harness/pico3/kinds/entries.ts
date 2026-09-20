import type { AssistantMessage, ToolResultMessage, UserMessage } from "@knightcode/ai";
import type { Entry, EntryKind, Id, JsonValue, SystemMessage, ToolControl } from "../types.ts";

export type UserEntry = Entry & {
	kind: "knightcode.user";
	model: [UserMessage];
	data?: { continuation: true; from: Id };
};
export type AssistantEntry = Entry & {
	kind: "knightcode.assistant";
	model: [AssistantMessage];
	data: { attempt: number };
};
export type ToolResultEntry = Entry & {
	kind: "knightcode.tool_result";
	model: [ToolResultMessage];
	data: {
		details?: JsonValue;
		diagnostics?: JsonValue;
		control?: ToolControl;
		truncated?: { bytes: number; lines: number };
	};
};
export type SystemEntry = Entry & { kind: "knightcode.system"; model: [SystemMessage]; data: { baseline: boolean } };
export type NoticeEntry = Entry & { kind: "knightcode.notice"; model: [UserMessage] };
export type UsageEntry = Entry & {
	kind: "knightcode.usage";
	data: { attempt: number; usage?: AssistantMessage["usage"]; error: string };
};
export type SummaryEntry = Entry & {
	kind: "knightcode.summary";
	model: [UserMessage];
	data: { through: Id };
	head: Id;
};
export type HandoffEntry = Entry & { kind: "knightcode.handoff"; model: [UserMessage]; head: Id };
export type ResetEntry = Entry & { kind: "knightcode.reset"; head: Id };

const coreEntry = <E extends Entry>(kind: string): EntryKind<E> =>
	Object.freeze({ kind, is: (entry: Entry | undefined): entry is E => entry?.kind === kind });

export const entries = {
	user: coreEntry<UserEntry>("knightcode.user"),
	assistant: coreEntry<AssistantEntry>("knightcode.assistant"),
	toolResult: coreEntry<ToolResultEntry>("knightcode.tool_result"),
	system: coreEntry<SystemEntry>("knightcode.system"),
	notice: coreEntry<NoticeEntry>("knightcode.notice"),
	usage: coreEntry<UsageEntry>("knightcode.usage"),
	summary: coreEntry<SummaryEntry>("knightcode.summary"),
	handoff: coreEntry<HandoffEntry>("knightcode.handoff"),
	reset: coreEntry<ResetEntry>("knightcode.reset"),
} as const;
