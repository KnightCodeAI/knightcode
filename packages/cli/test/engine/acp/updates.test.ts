import { describe, expect, test } from "vitest";
import { createSessionState, toSessionUpdates } from "../../../src/engine/acp/updates.ts";
import type { SessionEvent } from "../../../src/engine/events.ts";

const cwd = process.platform === "win32" ? "C:\\proj" : "/proj";
const sessionId = "s1";

function meta(update: { _meta?: { [key: string]: unknown } | null }): Record<string, unknown> {
	return (update._meta ?? {}) as Record<string, unknown>;
}

describe("session updates", () => {
	test("text and thinking deltas become message and thought chunks", () => {
		const state = createSessionState(cwd);
		const text: SessionEvent = { type: "session.delta", sessionId, messageId: "m1", kind: "text", delta: "hi" };
		const thought: SessionEvent = { type: "session.delta", sessionId, messageId: "m1", kind: "thinking", delta: "hm" };
		expect(toSessionUpdates(text, state)).toEqual([
			{ sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: "hi" } },
		]);
		expect(toSessionUpdates(thought, state)).toEqual([
			{ sessionUpdate: "agent_thought_chunk", messageId: "m1", content: { type: "text", text: "hm" } },
		]);
	});

	test("a tool call is announced once, then progressed, then completed with its output", () => {
		const state = createSessionState(cwd);
		const args = { path: "a.txt" };
		const [announced] = toSessionUpdates(
			{ type: "session.tool_call", sessionId, toolCallId: "t1", toolName: "read", args },
			state,
		);
		expect(announced).toMatchObject({
			sessionUpdate: "tool_call",
			toolCallId: "t1",
			title: "Read a.txt",
			kind: "read",
			status: "pending",
			rawInput: args,
			_meta: { tool_name: "read" },
		});
		expect(
			toSessionUpdates({ type: "session.tool_start", sessionId, toolCallId: "t1", toolName: "read", args }, state),
		).toEqual([{ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "in_progress" }]);
		const [ended] = toSessionUpdates(
			{
				type: "session.tool_end",
				sessionId,
				toolCallId: "t1",
				toolName: "read",
				content: [{ type: "text", text: "the file" }],
				details: { lineCount: 1 },
				isError: false,
			},
			state,
		);
		expect(ended).toMatchObject({
			sessionUpdate: "tool_call_update",
			toolCallId: "t1",
			status: "completed",
			content: [{ type: "content", content: { type: "text", text: "the file" } }],
			rawOutput: { content: "the file", details: { lineCount: 1 } },
		});
		expect(state.announced.has("t1")).toBe(false);
	});

	test("a start for an unannounced call announces it as in progress", () => {
		const state = createSessionState(cwd);
		const [update] = toSessionUpdates(
			{ type: "session.tool_start", sessionId, toolCallId: "t2", toolName: "grep", args: { pattern: "x" } },
			state,
		);
		expect(update).toMatchObject({
			sessionUpdate: "tool_call",
			toolCallId: "t2",
			status: "in_progress",
			kind: "search",
		});
	});

	test("a failed call is failed, a rejected call keeps its status, a diffed call keeps its diff", () => {
		const state = createSessionState(cwd);
		const end = (toolCallId: string, toolName: string, isError = true): SessionEvent => ({
			type: "session.tool_end",
			sessionId,
			toolCallId,
			toolName,
			content: [{ type: "text", text: "nope" }],
			details: undefined,
			isError,
		});
		expect(toSessionUpdates(end("t3", "bash"), state)[0]).toMatchObject({ status: "failed" });

		state.rejected.add("t4");
		const [rejected] = toSessionUpdates(end("t4", "write"), state);
		expect(rejected).toEqual({ sessionUpdate: "tool_call_update", toolCallId: "t4", rawOutput: { content: "nope" } });
		expect(state.rejected.has("t4")).toBe(false);

		state.diffed.add("t5");
		const [diffed] = toSessionUpdates(end("t5", "edit", false), state);
		expect(diffed).toEqual({
			sessionUpdate: "tool_call_update",
			toolCallId: "t5",
			status: "completed",
			rawOutput: { content: "nope" },
		});
		expect(state.diffed.has("t5")).toBe(false);
	});

	test("a call the abort failed keeps the client's cancelled status; one that finished is completed", () => {
		const state = createSessionState(cwd);
		state.cancelling = true;
		const end = (toolCallId: string, isError: boolean): SessionEvent => ({
			type: "session.tool_end",
			sessionId,
			toolCallId,
			toolName: "bash",
			content: [{ type: "text", text: isError ? "Operation aborted" : "done" }],
			details: undefined,
			isError,
		});
		expect(toSessionUpdates(end("t7", true), state)[0]).not.toHaveProperty("status");
		expect(toSessionUpdates(end("t8", false), state)[0]).toMatchObject({ status: "completed" });
	});

	test("a shell call gets a display-only terminal fed by output deltas and closed with its exit code", () => {
		const state = createSessionState(cwd);
		const args = { command: "npm test" };
		const [announced] = toSessionUpdates(
			{ type: "session.tool_call", sessionId, toolCallId: "t6", toolName: "bash", args },
			state,
		);
		const info = meta(announced).terminal_info as { terminal_id: string; cwd: string };
		expect(info.cwd).toBe(cwd);
		expect(announced).toMatchObject({
			title: "npm test",
			kind: "execute",
			content: [{ type: "terminal", terminalId: info.terminal_id }],
		});

		const update = (text: string): SessionEvent => ({
			type: "session.tool_update",
			sessionId,
			toolCallId: "t6",
			toolName: "bash",
			content: [{ type: "text", text }],
			details: undefined,
		});
		expect(meta(toSessionUpdates(update("one\n"), state)[0]).terminal_output).toEqual({
			terminal_id: info.terminal_id,
			data: "one\n",
		});
		expect(toSessionUpdates(update("one\n"), state)).toEqual([]);
		expect(meta(toSessionUpdates(update("one\ntwo\n"), state)[0]).terminal_output).toEqual({
			terminal_id: info.terminal_id,
			data: "two\n",
		});
		// Tail truncation moved the window: clear and repaint.
		expect((meta(toSessionUpdates(update("two\nthree\n"), state)[0]).terminal_output as { data: string }).data).toBe(
			"\u001b[2J\u001b[Htwo\nthree\n",
		);

		const [ended] = toSessionUpdates(
			{
				type: "session.tool_end",
				sessionId,
				toolCallId: "t6",
				toolName: "bash",
				content: [{ type: "text", text: "two\nthree\n\nCommand exited with code 2" }],
				details: undefined,
				isError: true,
			},
			state,
		);
		expect(ended).toMatchObject({ status: "failed" });
		expect(meta(ended).terminal_exit).toEqual({ terminal_id: info.terminal_id, exit_code: 2 });
		expect(ended).not.toHaveProperty("content");
		expect(state.terminals.has("t6")).toBe(false);
	});

	test("events with nothing to show produce nothing", () => {
		const state = createSessionState(cwd);
		expect(toSessionUpdates({ type: "session.created", sessionId, cwd }, state)).toEqual([]);
		expect(toSessionUpdates({ type: "session.message", sessionId, messageId: "m" }, state)).toEqual([]);
	});
});
