/**
 * Tool calling for Gemini web, which is a chat endpoint with no function-calling field. Tools are described in the
 * prompt and the model is told to answer with `<tool_call>` blocks, which are parsed back into tool calls.
 */

import type { JsonObject, TextContent, ToolCall, TranscriptContext } from "../types.ts";
import { estimateContextTokens } from "../utils/estimate.ts";
import { getSystemMessageText } from "../utils/text.ts";
import { getCurrentTools, getInitialSystemMessage } from "../utils/transcript.ts";
import { isGeminiWebErrorReply } from "./gemini-web-protocol.ts";

const OPEN_TAG = "<tool_call>";
const OPEN_RE = /<tool\\?_call>/i;
const MARKDOWN_ESCAPE_RE = /\\([_*~`])/g;

const TOOL_INSTRUCTIONS = [
	"You can use tools on every turn. There is no tool-call limit, no remaining budget, and tools are never disabled later in the session.",
	"To call tools, end your reply with one block per call, exactly in this form, with valid JSON and no code fence around it:",
	'<tool_call>{"name": "TOOL_NAME", "arguments": {"PARAMETER": "VALUE"}}</tool_call>',
	"After those blocks, end the reply. The result arrives in the next message inside <tool_result>, and you may call tools again.",
	"If the user asks you to create, update, or fix a file, call write or edit when listed, or use the listed script tool. Code printed in chat does not change files. Apply the changes yourself instead of handing the user replacements to paste.",
	"Respect the system instructions and permission limits. If the user asks only for an explanation or example, answer without editing files.",
	"Only call tools listed below, with arguments that match the tool's JSON schema. JSON strings must escape quotes and newlines. Keep edits small instead of copying whole components into replacement strings. If no tool is needed, answer normally and write no <tool_call> block.",
	"Before calling tools, briefly tell the user what you are about to check or change. Report progress, not hidden reasoning. Never claim a tool succeeded before its result arrives.",
	"Group independent tool calls in the same reply. Wait for their results before making dependent calls.",
	"Start long-running servers in separate background calls, not chained into foreground checks. Give diagnostic commands an explicit finite timeout. Check existing servers before starting duplicates; do not stop unrelated processes.",
].join("\n");

/** One corrective continuation for a false refusal, delegated edit, or withdrawn draft call. */
export const GEMINI_WEB_TOOL_RETRY =
	"There is no tool-call limit. Tools are still available. Your previous reply did not produce an executable tool call. If the user requested file changes, apply them yourself with the listed tools instead of returning code to copy. Read the relevant files if needed. Respect all system instructions and permission limits; do not modify files for explanation-only requests. Call the appropriate listed tool in the required <tool_call> form, then stop and wait for its result. Do not claim an edit succeeded before its result arrives.";

/** One correction before any malformed batch may execute. Shares the reply's single recovery budget. */
export const GEMINI_WEB_TOOL_FORMAT_RETRY =
	"Your proposed tool calls contained invalid JSON. None of the calls from that reply were executed. Regenerate the intended calls with valid JSON matching the listed schemas, escaping quotes and newlines inside strings. Use small, unique edit replacements rather than copying whole components. Re-read the source if needed. Respect permissions and earlier confirmed results; do not repeat successful operations or claim unexecuted edits succeeded.";

/** True when a text-only reply claims tools cannot be used. KnightCode has no such limit. */
export function declinedGeminiWebTools(text: string): boolean {
	// A mention of a limit (especially "there is no tool-call limit") is not a refusal. Retrying it spends quota.
	const claims = text
		.replace(/```[\s\S]*?```/g, "")
		.replace(/\b(?:hasn|haven|hadn|wasn|weren|isn|aren|didn|doesn|don)['’]t\b/gi, "not")
		.replace(
			/\b(?:not|never)\s+(?:yet\s+)?(?:reached|hit|exceeded|exhausted|at)\s+(?:(?:the|my|our|maximum|current|session)\s+)*tool[- ]call limits?/gi,
			"",
		);
	return (
		/\b(?:reached|hit|exceeded|exhausted|at)\s+(?:(?:the|my|our|maximum|current|session)\s+)*tool[- ]call limits?\b|tools? (?:are |is )?(?:currently )?disabled|(?:cannot|can't) (?:run|use|call) (?:the )?(?:write|edit|tools?)\b|unable to (?:use|call) tools?\b/i.test(
			claims,
		) ||
		/\btool[- ]call limits?\b[^.!?\n]{0,100}\b0 remaining\b|\b0 remaining\b[^.!?\n]{0,100}\btool(?:[- ]calls?)?\b/i.test(
			claims,
		)
	);
}

function text(content: string | readonly { type: string; text?: string }[]): string {
	if (typeof content === "string") return content;
	return content
		.map((block) => (block.type === "text" ? (block.text ?? "") : "[image omitted]"))
		.filter((part) => part.length > 0)
		.join("\n");
}

const EDIT_TOOLS = new Set(["edit", "write", "apply_patch", "codemode"]);

/** A narrow fallback for explicit edit requests answered with copy-paste code, not a blanket tool requirement. */
export function delegatedGeminiWebEdits(context: TranscriptContext, reply: string): boolean {
	if (!getCurrentTools(context.messages).some((tool) => EDIT_TOOLS.has(tool.name))) return false;
	const userIndex = context.messages.findLastIndex((message) => message.role === "user");
	const user = context.messages[userIndex];
	if (user?.role !== "user") return false;
	const request = text(user.content).replace(/```[\s\S]*?```/g, "");
	if (
		!/\b(?:fix|edit|update|modify|change|implement|apply|refactor|create|write|add|remove|replace|repair)\b/i.test(
			request,
		)
	)
		return false;
	if (
		!/\b(?:code|files?|project|repo(?:sitory)?|website|app|component|tests?|implementation|it|them|this)\b/i.test(
			request,
		) &&
		!/(?:[/\\]|\b[\w-]+\.[a-z0-9]{1,8}\b)/i.test(request)
	)
		return false;
	if (
		[
			/^\s*(?:how|what|why)\b/i,
			/\b(?:explain|describe|example|sample|snippet|pseudocode)\b/i,
			/\bhow\s+(?:to|do|can|should|would)\b/i,
			/\bjust\s+(?:tell|show)\b/i,
			/\b(?:show|tell)\s+(?:me\s+)?(?:how|what)/i,
			/\b(?:plan|read[- ]only) mode\b/i,
			/\b(?:do not|don['’]t|without)\s+(?:edit|modif|chang|apply|writ|touch)\w*\b/i,
			/\bin chat\b/i,
		].some((pattern) => pattern.test(request))
	)
		return false;
	// An attempted edit already went through execution or permission checks. Do not push past its result,
	// including a denied edit, or mistake a final explanation containing code for a missed action.
	if (
		context.messages
			.slice(userIndex + 1)
			.some((message) => message.role === "toolResult" && EDIT_TOOLS.has(message.toolName))
	)
		return false;
	return (
		reply.includes("```") ||
		/\b(?:apply|replace|paste|copy|update|edit|change|insert)\b[^.!?\n]{0,100}\b(?:code|files?|following|with|changes|your)\b/i.test(
			reply,
		)
	);
}

function renderToolCall(name: string, args: JsonObject): string {
	return `${OPEN_TAG}${JSON.stringify({ name, arguments: args })}</tool_call>`;
}

/**
 * Flatten a transcript into the single prompt string the web app accepts: instructions, tool schemas, then the
 * conversation, ending with the turn the model has to answer.
 */
export function buildGeminiWebPrompt(context: TranscriptContext, fromMessage = 0, compactHistory = false): string {
	const system = getInitialSystemMessage(context.messages);
	const tools = getCurrentTools(context.messages);
	const sections: string[] = [];

	if (fromMessage === 0 && system) sections.push(`<instructions>\n${getSystemMessageText(system)}\n</instructions>`);
	if (fromMessage === 0 && tools.length > 0) {
		const schemas = tools
			.map((tool) => JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters }))
			.join("\n");
		sections.push(`<tools>\n${TOOL_INSTRUCTIONS}\n\nTools, one JSON object per line:\n${schemas}\n</tools>`);
	}

	// Compact only cold replays, never new tool results in an incremental continuation. Keep the latest eight
	// results and the entire latest call batch verbatim, along with every error, user request and tool argument.
	const compact =
		fromMessage === 0 &&
		compactHistory &&
		tools.some((tool) => ["read", "bash", "powershell", "codemode"].includes(tool.name)) &&
		estimateContextTokens(context).tokens > 32_768;
	let keepFrom = context.messages.length;
	if (compact) {
		let results = 0;
		for (let index = context.messages.length - 1; index >= 0; index--) {
			const message = context.messages[index];
			if (message.role === "toolResult" && ++results <= 8) keepFrom = index;
		}
		const batch = context.messages.findLastIndex(
			(message) => message.role === "assistant" && message.stopReason === "toolUse",
		);
		if (batch >= 0) keepFrom = Math.min(keepFrom, batch);
	}
	let shortened = false;
	const turns: string[] = [];
	for (let index = fromMessage; index < context.messages.length; index++) {
		const message = context.messages[index];
		if (message.role === "user") {
			turns.push(`User: ${text(message.content)}`);
		} else if (message.role === "assistant") {
			// Like the native adapters, do not replay drafts from failed or interrupted generations.
			if (message.stopReason === "error" || message.stopReason === "aborted") continue;
			const parts = message.content.flatMap((block) => {
				if (block.type === "text") return block.text.trim() ? [block.text] : [];
				if (block.type === "toolCall")
					return [
						block.argumentsError
							? `[Proposed ${block.name} call rejected for invalid arguments before execution. No operation occurred.]`
							: renderToolCall(block.name, block.arguments),
					];
				return [];
			});
			const reply = parts.join("\n");
			if (reply && !(message.api === "gemini-web" && isGeminiWebErrorReply(reply))) turns.push(`Assistant: ${reply}`);
		} else if (message.role === "toolResult") {
			let body = text(message.content as readonly TextContent[]);
			if (compact && index < keepFrom && !message.isError && body.length > 2_000) {
				body = `${body.slice(0, 1_000)}\n[... ${body.length - 2_000} characters omitted from this older tool output ...]\n${body.slice(-1_000)}`;
				shortened = true;
			}
			const attributes = `name="${message.toolName}" id="${message.toolCallId}"${message.isError ? ' error="true"' : ""}`;
			turns.push(`<tool_result ${attributes}>\n${body}\n</tool_result>`);
		}
	}
	if (shortened) {
		sections.push(
			"Older tool outputs below contain explicit omission markers. They are historical excerpts, not complete file contents. Re-read any needed source before editing it. Successful operations already happened; do not repeat them. Full outputs remain in local session history.",
		);
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

/** Tags inside JSON strings are file content, not tool delimiters. Also keep an unfinished final block. */
function readToolBlocks(reply: string): { body: string; raw: string }[] {
	const blocks: { body: string; raw: string }[] = [];
	const open = /<tool\\?_call>/gi;
	for (let match = open.exec(reply); match; match = open.exec(reply)) {
		const start = match.index + match[0].length;
		let end = reply.length;
		let closeLength = 0;
		let inString = false;
		for (let index = start; index < reply.length; index++) {
			const char = reply[index];
			if (inString) {
				if (char === "\\") index++;
				else if (char === '"') inString = false;
			} else if (char === '"') inString = true;
			else if (char === "<") {
				const close = /^<\/tool\\?_call>/i.exec(reply.slice(index));
				if (close) {
					end = index;
					closeLength = close[0].length;
					break;
				}
			}
		}
		blocks.push({ body: reply.slice(start, end), raw: reply.slice(match.index, end + closeLength) });
		if (!closeLength) break;
		open.lastIndex = end + closeLength;
	}
	return blocks;
}

/** Exclusive end of a complete JSON string; undefined while its closing quote is still missing. */
function jsonStringEnd(text: string, start: number): number | undefined {
	for (let index = start + 1; index < text.length; index++) {
		if (text[index] === "\\") index++;
		else if (text[index] === '"') return index + 1;
	}
	return undefined;
}

/** Read in-progress calls without treating a partial JSON document as an executable call. */
export function readGeminiWebToolCallProgress(reply: string): { name: string; argumentsText?: string }[] {
	const calls: { name: string; argumentsText?: string }[] = [];
	for (const { body } of readToolBlocks(reply)) {
		const json = body.trim().replace(/^```[a-z]*\s*/i, "");
		if (!json.startsWith("{")) break;
		let cursor = 1;
		let name: string | undefined;
		let argumentsText: string | undefined;
		// Only root members name the tool or its arguments. Nested "name" fields belong to file/tool data.
		while (cursor < json.length) {
			while (/[\s,]/.test(json[cursor] ?? "")) cursor++;
			if (json[cursor] !== '"') break;
			const keyEnd = jsonStringEnd(json, cursor);
			if (keyEnd === undefined) break;
			let key: unknown;
			try {
				key = JSON.parse(json.slice(cursor, keyEnd));
			} catch {
				break;
			}
			cursor = keyEnd;
			while (/\s/.test(json[cursor] ?? "")) cursor++;
			if (json[cursor++] !== ":") break;
			while (/\s/.test(json[cursor] ?? "")) cursor++;
			const start = cursor;
			let depth = 0;
			let complete = false;
			while (cursor < json.length) {
				const char = json[cursor];
				if (char === '"') {
					const end = jsonStringEnd(json, cursor);
					if (end === undefined) {
						cursor = json.length;
						break;
					}
					cursor = end;
				} else if (char === "{" || char === "[") {
					depth++;
					cursor++;
					continue;
				} else if (depth > 0 && (char === "}" || char === "]")) {
					depth--;
					cursor++;
				} else if (depth === 0 && /[\s,}]/.test(char)) {
					complete = cursor > start;
					break;
				} else cursor++;
				if (depth === 0 && (json[start] === '"' || json[start] === "{" || json[start] === "[")) {
					complete = true;
					break;
				}
			}
			if (key === "arguments" && json[start] === "{") argumentsText = json.slice(start, cursor);
			if (key === "name" && complete && json[start] === '"') {
				try {
					const value: unknown = JSON.parse(json.slice(start, cursor));
					if (typeof value === "string" && value) name = value;
				} catch {
					break;
				}
			}
			if (!complete) break;
		}
		if (!name) break;
		calls.push({ name, ...(argumentsText === undefined ? {} : { argumentsText }) });
	}
	return calls;
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
	for (const block of readToolBlocks(reply)) {
		const call = toToolCall(block.body, "");
		if (call) {
			call.id = nextId();
			toolCalls.push(call);
		} else unreadable.push(block.raw);
	}

	const visible = visibleReplyText(reply, true);
	const textParts = [visible, ...unreadable].filter((part) => part.trim().length > 0);
	return { text: textParts.join("\n\n").trim(), toolCalls };
}
