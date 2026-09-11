/**
 * Engine session events to ACP `session/update` notifications.
 *
 * Pure: one engine event plus the per-session state the mapping needs, out
 * come the updates to send, in order. The state remembers which tool calls
 * the client has been told about, which the user rejected, which already
 * carry a diff, and the display-only terminal that shows a shell tool's
 * output while it runs.
 */

import { randomUUID } from "node:crypto";
import type { SessionUpdate, ToolCallContent } from "@agentclientprotocol/sdk";
import type { SessionEvent, ToolContent } from "../events.ts";
import { toolKind, toolLocations, toolResultContent, toolTitle } from "./tools.ts";

/** Zed's meta key for a tool call's programmatic name (`acp_thread.rs`, `TOOL_NAME_META_KEY`). */
const TOOL_NAME_META_KEY = "tool_name";

const SHELL_TOOLS: ReadonlySet<string> = new Set(["bash", "powershell"]);

/** Clear screen and home: sent when a snapshot no longer extends the previous one. */
const CLEAR = "\u001b[2J\u001b[H";

interface TerminalState {
	id: string;
	output: string;
}

export interface SessionState {
	cwd: string;
	/** Tool calls the client has been told about. */
	announced: Set<string>;
	/** Tool calls the user rejected; their end must not overwrite that status. */
	rejected: Set<string>;
	/** Tool calls whose card already shows a diff; their end must not replace it with text. */
	diffed: Set<string>;
	/** Display-only terminals by tool call id. */
	terminals: Map<string, TerminalState>;
	/**
	 * The client cancelled the turn. It has already marked its pending calls
	 * cancelled; a tool the abort failed must not repaint them as failed.
	 */
	cancelling: boolean;
}

export function createSessionState(cwd: string): SessionState {
	return { cwd, announced: new Set(), rejected: new Set(), diffed: new Set(), terminals: new Map(), cancelling: false };
}

function textOf(content: readonly ToolContent[]): string {
	return content
		.filter((block): block is Extract<ToolContent, { type: "text" }> => block.type === "text")
		.map((block) => block.text)
		.join("");
}

/**
 * The bash tool reports a cumulative snapshot on every update, and tail
 * truncation can drop its head. Send the suffix when the snapshot extends
 * what the terminal shows, and repaint when it does not.
 */
function terminalDelta(terminal: TerminalState, snapshot: string): string | undefined {
	if (snapshot === terminal.output) return undefined;
	const delta = snapshot.startsWith(terminal.output) ? snapshot.slice(terminal.output.length) : CLEAR + snapshot;
	terminal.output = snapshot;
	return delta;
}

/** Success is 0; failure carries "Command exited with code N" in its text; a kill has none. */
function exitCodeOf(text: string, isError: boolean): number | null {
	if (!isError) return 0;
	const match = /Command exited with code (\d+)\s*$/.exec(text);
	return match ? Number(match[1]) : null;
}

function announce(
	event: Extract<SessionEvent, { type: "session.tool_call" | "session.tool_start" }>,
	state: SessionState,
	status: "pending" | "in_progress",
): SessionUpdate {
	const { toolCallId, toolName, args } = event;
	state.announced.add(toolCallId);
	const meta: Record<string, unknown> = { [TOOL_NAME_META_KEY]: toolName };
	let content: ToolCallContent[] | undefined;
	if (SHELL_TOOLS.has(toolName)) {
		const terminal: TerminalState = { id: randomUUID(), output: "" };
		state.terminals.set(toolCallId, terminal);
		meta.terminal_info = { terminal_id: terminal.id, cwd: state.cwd };
		content = [{ type: "terminal", terminalId: terminal.id }];
	}
	return {
		sessionUpdate: "tool_call",
		toolCallId,
		title: toolTitle(toolName, args, state.cwd),
		kind: toolKind(toolName),
		status,
		locations: toolLocations(toolName, args, state.cwd),
		rawInput: args,
		...(content ? { content } : {}),
		_meta: meta,
	};
}

export function toSessionUpdates(event: SessionEvent, state: SessionState): SessionUpdate[] {
	switch (event.type) {
		case "session.delta":
			return [
				{
					sessionUpdate: event.kind === "thinking" ? "agent_thought_chunk" : "agent_message_chunk",
					messageId: event.messageId,
					content: { type: "text", text: event.delta },
				},
			];
		case "session.tool_call":
			return [announce(event, state, "pending")];
		case "session.tool_start":
			return state.announced.has(event.toolCallId)
				? [{ sessionUpdate: "tool_call_update", toolCallId: event.toolCallId, status: "in_progress" }]
				: [announce(event, state, "in_progress")];
		case "session.tool_update": {
			const terminal = state.terminals.get(event.toolCallId);
			if (terminal) {
				const delta = terminalDelta(terminal, textOf(event.content));
				if (delta === undefined) return [];
				return [
					{
						sessionUpdate: "tool_call_update",
						toolCallId: event.toolCallId,
						status: "in_progress",
						_meta: { terminal_output: { terminal_id: terminal.id, data: delta } },
					},
				];
			}
			// `content` replaces the card's collection; a diff already there must survive a progress update.
			if (state.diffed.has(event.toolCallId) || event.content.length === 0) return [];
			return [
				{
					sessionUpdate: "tool_call_update",
					toolCallId: event.toolCallId,
					status: "in_progress",
					content: toolResultContent(event.content),
				},
			];
		}
		case "session.tool_end": {
			const { toolCallId, content, isError } = event;
			const text = textOf(content);
			const terminal = state.terminals.get(toolCallId);
			state.terminals.delete(toolCallId);
			state.announced.delete(toolCallId);
			const rawOutput = { content: text, ...(event.details !== undefined ? { details: event.details } : {}) };
			if (state.rejected.delete(toolCallId) || (isError && state.cancelling)) {
				state.diffed.delete(toolCallId);
				return [{ sessionUpdate: "tool_call_update", toolCallId, rawOutput }];
			}
			const status = isError ? "failed" : "completed";
			if (terminal) {
				const delta = terminalDelta(terminal, text);
				return [
					{
						sessionUpdate: "tool_call_update",
						toolCallId,
						status,
						rawOutput,
						_meta: {
							...(delta === undefined ? {} : { terminal_output: { terminal_id: terminal.id, data: delta } }),
							terminal_exit: { terminal_id: terminal.id, exit_code: exitCodeOf(text, isError) },
						},
					},
				];
			}
			if (state.diffed.delete(toolCallId)) {
				return [{ sessionUpdate: "tool_call_update", toolCallId, status, rawOutput }];
			}
			return [
				{ sessionUpdate: "tool_call_update", toolCallId, status, content: toolResultContent(content), rawOutput },
			];
		}
		default:
			return [];
	}
}
