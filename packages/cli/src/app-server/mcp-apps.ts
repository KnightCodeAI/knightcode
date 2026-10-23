/**
 * MCP Apps over the app server (architecture.md section 4.4): an app a client draws reads its own server's resources
 * and calls its tools with `mcp/app/readResource` and `mcp/app/callTool`. The thread's session answers through its MCP
 * extension, over the session's event bus (MCP_APPS_CHANNEL), so the calls take the same path as the model's.
 *
 * Both are bounded well under the stdio transport's limits (a 64 MiB output line aborts the connection, an input line
 * past it is dropped unanswered): arguments to 1 MiB and results to 4 MiB, serialized; a tool's larger result is left
 * out of an answer that says it ran, since it did. Outside Full access a tool that
 * does not say it only reads answers `approvalRequired` until the client confirms with the user. A call during a turn
 * runs at once; it does not wait for the turn.
 */

import type { ApprovalMode, ParamsOf, ResultOf } from "@knightcode/app-server-protocol";
import type { EventBus } from "../core/event-bus.ts";
import type { InlineExtension } from "../core/extensions/types.ts";
import {
	MCP_APPS_CHANNEL,
	type McpAppAnswer,
	type McpAppQuery,
	type McpAppRequest,
	type McpAppToolInfo,
} from "../core/mcp-servers.ts";
import { AppServerError } from "./errors.ts";

export const MCP_APP_ARGUMENTS_MAX_BYTES = 1024 * 1024;
export const MCP_APP_RESULT_MAX_BYTES = 4 * 1024 * 1024;
/** How long an answer from the MCP extension may take; a tool's own timeout is usually shorter. */
const ANSWER_TIMEOUT_MS = 60_000;

/** Where a thread's MCP extension is reached: its session's event bus, captured by the inline extension below. */
export interface McpAppsHolder {
	mcpApps?: EventBus;
}

/** Captures the session's event bus for the thread's `mcp/app/*` requests. */
export function createMcpAppsExtension(holder: McpAppsHolder): InlineExtension {
	return {
		name: "app-server-mcp-apps",
		hidden: true,
		factory: (knightcode) => {
			holder.mcpApps = knightcode.events;
		},
	};
}

const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value) ?? "");

/** One request to the thread's MCP extension; its error codes are the protocol's. */
function ask(bus: EventBus | undefined, request: McpAppQuery): Promise<unknown> {
	if (!bus) return Promise.reject(new AppServerError("mcpUnavailable", "MCP is not running in this thread"));
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new AppServerError("internal", "the thread's MCP extension did not answer within 60 s")),
			ANSWER_TIMEOUT_MS,
		);
		const reply = (answer: McpAppAnswer) => {
			clearTimeout(timer);
			if ("error" in answer) reject(new AppServerError(answer.error.code, answer.error.message));
			else resolve(answer.result);
		};
		let heard = false;
		bus.emit(MCP_APPS_CHANNEL, { ...request, heard: () => (heard = true), reply } as McpAppRequest);
		// The MCP extension is off in this thread (disabledBuiltinExtensions): nothing will answer.
		if (!heard) reply({ error: { code: "mcpUnavailable", message: "MCP is not running in this thread" } });
	});
}

function bounded(result: unknown): void {
	if (size(result) > MCP_APP_RESULT_MAX_BYTES)
		throw new AppServerError("invalidParams", "result too large: over 4 MiB serialized");
}

export async function readAppResource(
	bus: EventBus | undefined,
	params: ParamsOf<"mcp/app/readResource">,
): Promise<ResultOf<"mcp/app/readResource">> {
	const result = (await ask(bus, { op: "readResource", server: params.server, uri: params.uri })) as {
		contents?: unknown[];
		_meta?: Record<string, unknown>;
	};
	bounded(result);
	return { contents: result.contents ?? [], ...(result._meta ? { _meta: result._meta } : {}) };
}

export async function callAppTool(
	bus: EventBus | undefined,
	approvalMode: ApprovalMode,
	params: ParamsOf<"mcp/app/callTool">,
): Promise<ResultOf<"mcp/app/callTool">> {
	const args = params.arguments ?? {};
	if (size(args) > MCP_APP_ARGUMENTS_MAX_BYTES)
		throw new AppServerError("invalidParams", "arguments too large: over 1 MiB serialized");
	const tool = (await ask(bus, { op: "describe", server: params.server, name: params.name })) as McpAppToolInfo;
	if (approvalMode !== "fullAccess" && !tool.readOnly && !params.confirmed)
		throw new AppServerError(
			"approvalRequired",
			`"${params.server}/${params.name}" may change things; it runs once the user confirms`,
			{ server: params.server, tool: params.name },
		);
	const result = (await ask(bus, { op: "callTool", server: params.server, name: params.name, arguments: args })) as {
		content?: unknown[];
		structuredContent?: unknown;
		isError?: boolean;
		_meta?: Record<string, unknown>;
	};
	// It ran: an error here would read as a failure, and the app might run it again.
	if (size(result) > MCP_APP_RESULT_MAX_BYTES)
		return {
			content: [{ type: "text", text: "The tool ran; its result was over 4 MiB serialized and was left out." }],
			...(result.isError ? { isError: true } : {}),
		};
	return {
		content: result.content ?? [],
		...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
		...(result.isError ? { isError: true } : {}),
		...(result._meta ? { _meta: result._meta } : {}),
	};
}
