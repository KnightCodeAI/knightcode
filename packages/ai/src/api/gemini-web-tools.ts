/**
 * Tool calling for Gemini web, which is a chat endpoint with no function-calling field. Tools are described in the
 * prompt and the model is told to answer with `<tool_call>` blocks, which are parsed back into tool calls.
 */

import type { JsonObject, TextContent, ToolCall, TranscriptContext } from "../types.ts";
import { getSystemMessageText } from "../utils/text.ts";
import { getCurrentTools, getInitialSystemMessage, withoutInitialSystemMessage } from "../utils/transcript.ts";

const OPEN_TAG = "<tool_call>";
const OPEN_RE = /<tool\\?_call>/i;
const BLOCK_RE = /<tool\\?_call>([\s\S]*?)<\/tool\\?_call>/gi;
const UNCLOSED_RE = /<tool\\?_call>(?![\s\S]*<\/tool\\?_call>)([\s\S]*)$/i;
const MARKDOWN_ESCAPE_RE = /\\([_*~`])/g;

const TOOL_INSTRUCTIONS = [
	"You can use tools on every turn. There is no tool-call limit, no remaining budget, and tools are never disabled later in the session.",
	"To call tools, end your reply with one block per call, exactly in this form, with valid JSON and no code fence around it:",
	'<tool_call>{"name": "TOOL_NAME", "arguments": {"PARAMETER": "VALUE"}}</tool_call>',
	"After those blocks, end the reply. The result arrives in the next message inside <tool_result>, and you may call tools again.",
	"If the user asks you to create, update, or fix a file, call write or edit. Do not tell them to run a command, and do not claim you cannot use tools.",
	"Only call tools listed below, with arguments that match the tool's JSON schema. If no tool is needed, answer normally and write no <tool_call> block.",
].join("\n");

/** Appended once when a reply refuses to call tools. There is no such limit; the model invented it. */
export const GEMINI_WEB_TOOL_RETRY =
	"There is no tool-call limit. Tools are still available. Do not tell the user to run a command or open a new thread. Call the tool now, in the required <tool_call> form, then stop.";

/** True when a text-only reply claims tools cannot be used. KnightCode has no such limit. */
export function declinedGeminiWebTools(text: string): boolean {
	return /tool[- ]call limit|maximum tool-call limit|0 remaining|tools? (?:are |is )?(?:currently )?disabled|cannot (?:run|use|call) (?:the )?(?:write|edit|tools?)|unable to (?:use|call) tools/i.test(
		text,
	);
}

function text(content: string | readonly { type: string; text?: string }[]): string {
	if (typeof content === "string") return content;
	return content
		.map((block) => (block.type === "text" ? (block.text ?? "") : "[image omitted]"))
		.filter((part) => part.length > 0)
		.join("\n");
}

function renderToolCall(name: string, args: JsonObject): string {
	return `${OPEN_TAG}${JSON.stringify({ name, arguments: args })}</tool_call>`;
}

/**
 * Flatten a transcript into the single prompt string the web app accepts: instructions, tool schemas, then the
 * conversation, ending with the turn the model has to answer.
 */
export function buildGeminiWebPrompt(context: TranscriptContext): string {
	const system = getInitialSystemMessage(context.messages);
	const tools = getCurrentTools(context.messages);
	const sections: string[] = [];

	if (system) sections.push(`<instructions>\n${getSystemMessageText(system)}\n</instructions>`);
	if (tools.length > 0) {
		const schemas = tools
			.map((tool) => JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters }))
			.join("\n");
		sections.push(`<tools>\n${TOOL_INSTRUCTIONS}\n\nTools, one JSON object per line:\n${schemas}\n</tools>`);
	}

	const turns: string[] = [];
	for (const message of withoutInitialSystemMessage(context.messages)) {
		if (message.role === "user") {
			turns.push(`User: ${text(message.content)}`);
		} else if (message.role === "assistant") {
			const parts = message.content.flatMap((block) => {
				if (block.type === "text") return block.text.trim() ? [block.text] : [];
				if (block.type === "toolCall") return [renderToolCall(block.name, block.arguments)];
				return [];
			});
			if (parts.length > 0) turns.push(`Assistant: ${parts.join("\n")}`);
		} else if (message.role === "toolResult") {
			const body = text(message.content as readonly TextContent[]);
			const attributes = `name="${message.toolName}" id="${message.toolCallId}"${message.isError ? ' error="true"' : ""}`;
			turns.push(`<tool_result ${attributes}>\n${body}\n</tool_result>`);
		}
	}
	sections.push(`<conversation>\n${turns.join("\n\n")}\n</conversation>`);
	if (tools.length > 0) {
		sections.push(
			"If the last message asks you to change a file or run a command, end this reply with a <tool_call>. There is no tool-call limit.",
		);
	}
	sections.push("Reply as the Assistant to the last message.");
	return sections.join("\n\n");
}

/**
 * The part of a reply to show as text: everything before the first tool call. While the reply is unfinished, a
 * trailing fragment that could still become `<tool_call>` is held back so half a tag never reaches the user.
 */
export function visibleReplyText(reply: string, final: boolean): string {
	const open = OPEN_RE.exec(reply);
	if (open) {
		return reply
			.slice(0, open.index)
			.replace(/\s*```[a-z]*\s*$/i, "")
			.trimEnd();
	}
	if (final) return reply;
	const lastAngle = reply.lastIndexOf("<");
	if (lastAngle >= 0) {
		const fragment = reply.slice(lastAngle).replace(/\\/g, "").toLowerCase();
		if (fragment.length < OPEN_TAG.length && OPEN_TAG.startsWith(fragment)) return reply.slice(0, lastAngle);
	}
	return reply;
}

function parseJsonObject(body: string): Record<string, unknown> | undefined {
	for (const candidate of [body, body.replace(MARKDOWN_ESCAPE_RE, "$1")]) {
		const cleaned = candidate
			.trim()
			.replace(/^```[a-z]*\s*/i, "")
			.replace(/\s*```$/, "");
		try {
			const parsed: unknown = JSON.parse(cleaned);
			if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
				return parsed as Record<string, unknown>;
			}
		} catch {
			// Try the next candidate, then fall through to the name-only recovery.
		}
	}
	return undefined;
}

function toToolCall(body: string, id: string): ToolCall | undefined {
	const parsed = parseJsonObject(body);
	if (!parsed) {
		const name = /"name"\s*:\s*"([^"]+)"/.exec(body)?.[1];
		if (!name) return undefined;
		return {
			type: "toolCall",
			id,
			name,
			arguments: {},
			argumentsError: `The tool call JSON could not be parsed. Received: ${body.trim().slice(0, 500)}`,
		};
	}
	if (typeof parsed.name !== "string" || !parsed.name) return undefined;

	let args = parsed.arguments;
	if (typeof args === "string") args = parseJsonObject(args) ?? args;
	if (args === undefined || args === null) args = {};
	if (typeof args !== "object" || Array.isArray(args)) {
		return {
			type: "toolCall",
			id,
			name: parsed.name,
			arguments: {},
			argumentsError: `The tool call arguments must be a JSON object. Received: ${JSON.stringify(args).slice(0, 500)}`,
		};
	}
	return { type: "toolCall", id, name: parsed.name, arguments: args as JsonObject };
}

export interface ParsedGeminiWebReply {
	text: string;
	toolCalls: ToolCall[];
}

/**
 * Split a finished reply into text and tool calls. A block that cannot be read as a call stays in the text, so the
 * model sees its own malformed output on the next turn instead of the call vanishing.
 */
export function parseGeminiWebReply(reply: string, nextId: () => string): ParsedGeminiWebReply {
	const toolCalls: ToolCall[] = [];
	const unreadable: string[] = [];
	for (const match of reply.matchAll(BLOCK_RE)) {
		const call = toToolCall(match[1], nextId());
		if (call) toolCalls.push(call);
		else unreadable.push(match[0]);
	}
	const unclosed = UNCLOSED_RE.exec(reply);
	if (unclosed) {
		const call = toToolCall(unclosed[1], nextId());
		if (call) toolCalls.push(call);
		else unreadable.push(unclosed[0]);
	}

	const visible = visibleReplyText(reply, true);
	const textParts = [visible, ...unreadable].filter((part) => part.trim().length > 0);
	return { text: textParts.join("\n\n").trim(), toolCalls };
}
