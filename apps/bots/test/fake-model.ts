// A scripted model for tests: an in-process @knightcode/ai provider ("fake", models "fake-model" and "fake-fast")
// that streams each turn of the script in order. No test calls a real provider.
import type { Provider } from "@knightcode/ai";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxThinking, fauxToolCall } from "@knightcode/ai/providers/faux";

/** One model reply: text, or text with tool calls and thinking. */
export type FakeTurn =
	| string
	| {
			text?: string;
			thinking?: string;
			toolCalls?: { name: string; arguments: Parameters<typeof fauxToolCall>[1]; id?: string }[];
	  };

/** A provider whose replies are `script`, one per model call. */
export function fakeModelProvider(script: FakeTurn[]): Provider {
	const fake = fauxProvider({ provider: "fake", models: [{ id: "fake-model" }, { id: "fake-fast" }] });
	fake.setResponses(
		script.map((turn) => {
			if (typeof turn === "string") return fauxAssistantMessage(turn);
			const blocks = [
				...(turn.thinking ? [fauxThinking(turn.thinking)] : []),
				...(turn.text ? [fauxText(turn.text)] : []),
				...(turn.toolCalls ?? []).map((call) => fauxToolCall(call.name, call.arguments, { id: call.id })),
			];
			return fauxAssistantMessage(blocks, { stopReason: turn.toolCalls?.length ? "toolUse" : "stop" });
		}),
	);
	return fake.provider;
}
