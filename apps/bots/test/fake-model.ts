// A scripted model for tests: an in-process @knightcode/ai provider ("fake", models "fake-model" and "fake-fast")
// that streams each turn of the script in order. No test calls a real provider.
import type { Models, Provider } from "@knightcode/ai";
import { createModels } from "@knightcode/ai/models";
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

/** One scripted reply for `fakeModels`: its text, and an optional wait before it starts streaming. */
export type FakeReply = { text: string; delayMs?: number };

/**
 * Models with only the fake provider, replying with `replies` in order and streaming each a few characters at a time.
 * Once the script runs out the last reply repeats, so a request retried after a crash gets the same answer.
 */
export function fakeModels(replies: FakeReply[], tokensPerSecond = 40): Models {
	const fake = fauxProvider({
		provider: "fake",
		models: [{ id: "fake-model" }, { id: "fake-fast" }],
		tokensPerSecond,
		tokenSize: { min: 1, max: 1 },
	});
	let calls = 0;
	const step = async () => {
		const reply = replies[Math.min(calls++, replies.length - 1)]!;
		if (reply.delayMs) await new Promise((resolve) => setTimeout(resolve, reply.delayMs));
		return fauxAssistantMessage(reply.text);
	};
	fake.setResponses(Array.from({ length: 50 }, () => step));
	const models = createModels();
	models.setProvider(fake.provider);
	return models;
}
