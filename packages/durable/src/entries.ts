import type { JsonValue } from "@knightcode/chord";
import type { Entry, EntryRecord, TypedEntry } from "./types.ts";

/** Define a typed entry kind whose `is()` guard narrows by `EntryRecord.kind`. */
export function defineEntry<D extends JsonValue = never>(kind: string): Entry<D> {
	if (typeof kind !== "string" || kind.length === 0) throw new TypeError("Entry kind must be a non-empty string");
	return {
		kind,
		is: (entry: EntryRecord | undefined): entry is TypedEntry<D> => entry !== undefined && entry.kind === kind,
	};
}

/** User input: `model` is `[UserMessage]`. Written by submissions. */
export const UserEntry = defineEntry("knightcode.user");
/** Provider result with any stop reason: `model` is `[AssistantMessage]`. Written by generation. */
export const AssistantEntry = defineEntry("knightcode.assistant");
/** Positional prompt and tool change: `model` is `[SystemMessage]` with empty `content`. */
export const SystemEntry = defineEntry("knightcode.system");
/** Tool result: `model` is `[ToolResultMessage]`. Written by tool tasks. */
export const ToolResultEntry = defineEntry("knightcode.tool-result");
