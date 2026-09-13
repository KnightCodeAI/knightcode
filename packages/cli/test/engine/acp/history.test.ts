import { describe, expect, test } from "vitest";
import { historyUpdates } from "../../../src/engine/acp/updates.ts";

describe("history updates", () => {
	const cwd = "/work";

	test("a transcript replays as the user's words, the assistant's text and thinking, and finished tool cards", () => {
		const updates = historyUpdates(
			[
				{ role: "user", content: "fix it", timestamp: 1 },
				{
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "look first" },
						{ type: "text", text: "Reading." },
						{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "a.txt" } },
						{ type: "toolCall", id: "call-2", name: "bash", arguments: { command: "false" } },
						{ type: "toolCall", id: "call-3", name: "read", arguments: { path: "b.txt" } },
					],
					stopReason: "toolUse",
					timestamp: 2,
				},
				{
					role: "toolResult",
					toolCallId: "call-1",
					toolName: "read",
					content: [{ type: "text", text: "hello" }],
					isError: false,
					timestamp: 3,
				},
				{
					role: "toolResult",
					toolCallId: "call-2",
					toolName: "bash",
					content: [{ type: "text", text: "Command exited with code 1" }],
					isError: true,
					timestamp: 4,
				},
				{ role: "custom", customType: "note", content: "not shown", timestamp: 5 },
				{
					role: "user",
					content: [
						{ type: "text", text: "and this" },
						{ type: "image", data: "aGk=", mimeType: "image/png" },
					],
					timestamp: 6,
				},
			],
			cwd,
		);

		expect(updates.map((update) => update.sessionUpdate)).toEqual([
			"user_message_chunk",
			"agent_thought_chunk",
			"agent_message_chunk",
			"tool_call",
			"tool_call",
			"tool_call",
			"user_message_chunk",
			"user_message_chunk",
		]);
		expect(updates[0]).toMatchObject({ content: { type: "text", text: "fix it" } });
		expect(updates[1]).toMatchObject({ content: { type: "text", text: "look first" } });
		expect(updates[3]).toMatchObject({
			toolCallId: "call-1",
			kind: "read",
			status: "completed",
			rawInput: { path: "a.txt" },
			content: [{ type: "content", content: { type: "text", text: "hello" } }],
			rawOutput: { content: "hello" },
			_meta: { tool_name: "read" },
		});
		expect(updates[4]).toMatchObject({ toolCallId: "call-2", status: "failed" });
		// No result: the call never finished.
		expect(updates[5]).toMatchObject({ toolCallId: "call-3", status: "failed" });
		expect(updates[5]).not.toHaveProperty("content");
		expect(updates[7]).toMatchObject({ content: { type: "image", data: "aGk=", mimeType: "image/png" } });

		const idOf = (index: number) => (updates[index] as { messageId?: string }).messageId;
		expect(idOf(1)).toBe(idOf(2));
		expect(idOf(0)).not.toBe(idOf(1));
		expect(idOf(6)).toBe(idOf(7));
	});

	test("redacted thinking and empty text are not shown", () => {
		const updates = historyUpdates(
			[
				{
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "secret", redacted: true },
						{ type: "text", text: "" },
					],
					stopReason: "stop",
					timestamp: 1,
				},
			],
			cwd,
		);
		expect(updates).toEqual([]);
	});
});
