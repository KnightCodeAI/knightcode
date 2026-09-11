/**
 * The ACP agent.
 *
 * Speaks ACP to the editor on one side and the engine's HTTP API on the
 * other, and holds nothing of its own beyond the bookkeeping the mapping
 * needs. The editor owns the filesystem: every read and write the engine's
 * tools make arrives here as a client request and is answered with
 * `fs/read_text_file` and `fs/write_text_file`, which is what puts agent
 * edits into the editor's buffers under review instead of onto disk behind
 * its back.
 */

import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
	agent,
	type AgentApp,
	type AgentContext,
	type ClientCapabilities,
	type PermissionOption,
	PROTOCOL_VERSION,
	RequestError,
	type RequestPermissionResponse,
	type SessionConfigOption,
	type SessionConfigSelectGroup,
	type SessionUpdate,
	type ToolCallContent,
	type ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import { applyEditsToNormalizedContent, type Edit, normalizeToLF } from "../../core/tools/edit-diff.ts";
import { splitBom } from "../../utils/text.ts";
import type { ClientReply, ClientRequest, PermissionOutcome } from "../client-requests.ts";
import type { EngineEvent } from "../events.ts";
import type { EngineModel } from "../models.ts";
import type { SessionSummary } from "../sessions.ts";
import { toPromptInput } from "./content.ts";
import { type EngineClient, EngineRequestError } from "./engine-client.ts";
import { toolKind, toolLocations, toolTitle } from "./tools.ts";
import { createSessionState, type SessionState, toSessionUpdates } from "./updates.ts";

export interface AcpAgentOptions {
	name?: string;
	version?: string;
}

type TurnEnd = Extract<EngineEvent, { type: "session.turn_end" }>;

interface AdapterSession {
	summary: SessionSummary;
	state: SessionState;
	/** What the client returned for a path during a tool call: the old side of that call's diff. */
	reads: Map<string, string>;
	turn?: { resolve(end: TurnEnd): void; reject(error: Error): void };
}

const PERMISSION_OPTIONS: readonly (PermissionOption & { optionId: PermissionOutcome })[] = [
	{ optionId: "allow_once", name: "Allow", kind: "allow_once" },
	{ optionId: "allow_always", name: "Always allow", kind: "allow_always" },
	{ optionId: "reject_once", name: "Reject", kind: "reject_once" },
];

/** `RequestError.resourceNotFound()`: the client does not own that path. */
const RESOURCE_NOT_FOUND = -32002;

const readKey = (toolCallId: string, path: string): string => `${toolCallId}\u0000${path}`;

function toOutcome(response: RequestPermissionResponse): PermissionOutcome {
	const { outcome } = response;
	if (outcome.outcome !== "selected") return "cancelled";
	return PERMISSION_OPTIONS.find((option) => option.optionId === outcome.optionId)?.optionId ?? "cancelled";
}

/** Engine failures as the JSON-RPC errors Zed acts on: auth_required opens sign-in, internal shows `details`. */
function toRequestError(error: unknown): RequestError {
	if (error instanceof RequestError) return error;
	if (error instanceof EngineRequestError) {
		if (error.status === 401) return RequestError.authRequired({ details: error.message });
		if (error.status === 404) return RequestError.resourceNotFound(error.message);
		if (error.status === 400) return RequestError.invalidParams({ details: error.message });
	}
	return RequestError.internalError({ details: error instanceof Error ? error.message : String(error) });
}

async function withEngine<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		throw toRequestError(error);
	}
}

export function toConfigOptions(summary: SessionSummary, models: readonly EngineModel[]): SessionConfigOption[] {
	const options: SessionConfigOption[] = [];
	if (summary.model) {
		const groups = new Map<string, SessionConfigSelectGroup>();
		for (const model of models) {
			const group = groups.get(model.providerId) ?? { group: model.providerId, name: model.providerName, options: [] };
			group.options.push({ value: model.ref, name: model.name });
			groups.set(model.providerId, group);
		}
		// The current model is always selectable, even when the catalog has moved on.
		if (!models.some((model) => model.ref === summary.model?.ref)) {
			groups.set(summary.model.providerId, {
				group: summary.model.providerId,
				name: summary.model.providerId,
				options: [{ value: summary.model.ref, name: summary.model.name }],
			});
		}
		options.push({
			id: "model",
			name: "Model",
			category: "model",
			type: "select",
			currentValue: summary.model.ref,
			options: [...groups.values()],
		});
	}
	options.push({
		id: "thinking",
		name: "Thinking",
		category: "thought_level",
		type: "select",
		currentValue: summary.thinkingLevel,
		options: summary.thinkingLevels.map((level) => ({ value: level, name: level })),
	});
	return options;
}

function isEdits(value: unknown): value is Edit[] {
	return (
		Array.isArray(value) &&
		value.every(
			(edit) =>
				typeof edit === "object" &&
				edit !== null &&
				typeof (edit as Edit).oldText === "string" &&
				typeof (edit as Edit).newText === "string",
		)
	);
}

/**
 * The text a tool will see for a path: the editor's buffer, or disk when the
 * client cannot read or does not own the path — the same fallback the
 * engine's file operations make. Absent when neither has it.
 */
async function readForPreview(
	cx: AgentContext,
	sessionId: string,
	path: string,
	canRead: boolean,
): Promise<string | undefined> {
	if (canRead) {
		try {
			return (await cx.request("fs/read_text_file", { sessionId, path })).content;
		} catch {
			// Fall through to disk, as the engine will.
		}
	}
	try {
		return await readFile(path, "utf-8");
	} catch {
		return undefined;
	}
}

/**
 * The change an edit or write will make, computed the way the tool computes
 * it from the editor's current text, so the user approves the actual change.
 * Absent when the edit will not apply; the tool then reports why.
 */
async function editPreview(
	cx: AgentContext,
	sessionId: string,
	toolName: string,
	input: unknown,
	cwd: string,
	canRead: boolean,
): Promise<ToolCallContent[] | undefined> {
	if (toolName !== "edit" && toolName !== "write") return undefined;
	const args = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
	if (typeof args.path !== "string") return undefined;
	const path = isAbsolute(args.path) ? args.path : resolve(cwd, args.path);
	const current = await readForPreview(cx, sessionId, path, canRead);
	if (toolName === "write") {
		if (typeof args.content !== "string") return undefined;
		return [{ type: "diff", path, oldText: current ?? null, newText: args.content }];
	}
	if (current === undefined || !isEdits(args.edits)) return undefined;
	try {
		const { baseContent, newContent } = applyEditsToNormalizedContent(
			normalizeToLF(splitBom(current).text),
			args.edits,
			path,
		);
		return [{ type: "diff", path, oldText: baseContent, newText: newContent }];
	} catch {
		return undefined;
	}
}

export function createAcpAgent(engine: EngineClient, options: AcpAgentOptions = {}): AgentApp {
	const name = options.name ?? "knightcode";
	const sessions = new Map<string, AdapterSession>();
	let client: AgentContext | undefined;
	let capabilities: ClientCapabilities = {};

	const canRead = (): boolean => capabilities.fs?.readTextFile === true;
	const canWrite = (): boolean => capabilities.fs?.writeTextFile === true;

	function requireClient(): AgentContext {
		if (!client) throw RequestError.internalError({ details: "no client connection" });
		return client;
	}

	function requireSession(sessionId: string): AdapterSession {
		const session = sessions.get(sessionId);
		if (!session) throw RequestError.invalidParams({ sessionId }, "unknown session");
		return session;
	}

	async function notify(sessionId: string, update: SessionUpdate): Promise<void> {
		await requireClient().notify("session/update", { sessionId, update });
	}

	async function configOptions(summary: SessionSummary): Promise<SessionConfigOption[]> {
		return toConfigOptions(summary, await engine.models());
	}

	function settleTurn(session: AdapterSession, end: TurnEnd): void {
		session.turn?.resolve(end);
		session.turn = undefined;
	}

	function failTurns(reason: string): void {
		for (const session of sessions.values()) {
			session.turn?.reject(new Error(reason));
			session.turn = undefined;
		}
	}

	async function closeAll(): Promise<void> {
		const open = [...sessions.keys()];
		sessions.clear();
		for (const id of open) await engine.closeSession(id).catch(() => undefined);
	}

	async function answer(session: AdapterSession, request: ClientRequest): Promise<ClientReply> {
		const sessionId = session.summary.id;
		const cx = requireClient();
		switch (request.kind) {
			case "fs.read": {
				const { content } = await cx.request("fs/read_text_file", { sessionId, path: request.path });
				if (request.toolCallId) session.reads.set(readKey(request.toolCallId, request.path), content);
				return { kind: "fs.read", content };
			}
			case "fs.write": {
				// The old side of the diff is what the tool read, or what the editor
				// holds now for a tool that writes without reading.
				const known = request.toolCallId ? session.reads.get(readKey(request.toolCallId, request.path)) : undefined;
				const oldText = known ?? (await readForPreview(cx, sessionId, request.path, canRead()));
				await cx.request("fs/write_text_file", { sessionId, path: request.path, content: request.content });
				if (request.toolCallId) {
					session.state.diffed.add(request.toolCallId);
					await notify(sessionId, {
						sessionUpdate: "tool_call_update",
						toolCallId: request.toolCallId,
						kind: "edit",
						locations: [{ path: request.path }],
						content: [{ type: "diff", path: request.path, oldText: oldText ?? null, newText: request.content }],
					});
				}
				return { kind: "fs.write" };
			}
			case "permission": {
				const { cwd } = session.state;
				const content = await editPreview(cx, sessionId, request.toolName, request.input, cwd, canRead());
				const toolCall: ToolCallUpdate = {
					toolCallId: request.toolCallId,
					title: toolTitle(request.toolName, request.input, cwd),
					kind: toolKind(request.toolName),
					status: "pending",
					locations: toolLocations(request.toolName, request.input, cwd),
					rawInput: request.input,
					...(content ? { content } : {}),
					_meta: { tool_name: request.toolName },
				};
				const response = await cx.request("session/request_permission", {
					sessionId,
					toolCall,
					options: [...PERMISSION_OPTIONS],
				});
				const outcome = toOutcome(response);
				if (outcome === "reject_once" || outcome === "reject_always") session.state.rejected.add(request.toolCallId);
				return { kind: "permission", outcome };
			}
		}
	}

	async function handleRequest(session: AdapterSession, requestId: string, request: ClientRequest): Promise<void> {
		let reply: ClientReply;
		try {
			reply = await answer(session, request);
		} catch (error) {
			const notFound = error instanceof RequestError && error.code === RESOURCE_NOT_FOUND;
			reply = {
				kind: "error",
				code: notFound ? "not_found" : "failed",
				message: error instanceof Error ? error.message : String(error),
			};
		}
		try {
			await engine.reply(session.summary.id, requestId, reply);
		} catch (error) {
			// The engine forgets a request it has aborted; a late answer is not a fault.
			if (!(error instanceof EngineRequestError && error.status === 404)) throw error;
		}
	}

	async function handleEvent(event: EngineEvent): Promise<void> {
		if (!("sessionId" in event)) return;
		const session = sessions.get(event.sessionId);
		if (!session) return;
		switch (event.type) {
			case "session.request":
				// Not awaited: a permission prompt can wait on the user for minutes, and
				// other sessions' events must keep flowing meanwhile.
				void handleRequest(session, event.requestId, event.request).catch((error: unknown) => {
					console.error(`[acp] request ${event.requestId} failed:`, error);
				});
				return;
			case "session.turn_end":
				settleTurn(session, event);
				return;
			case "session.tool_end":
				for (const key of [...session.reads.keys()]) {
					if (key.startsWith(`${event.toolCallId}\u0000`)) session.reads.delete(key);
				}
				break;
			default:
				break;
		}
		for (const update of toSessionUpdates(event, session.state)) await notify(event.sessionId, update);
	}

	return agent({ name })
		.onConnect((connection) => {
			client = connection.client;
			void engine.events(
				{ onEvent: handleEvent, onDisconnect: () => failTurns("engine event stream disconnected") },
				connection.signal,
			);
			void connection.closed.then(closeAll);
		})
		.onRequest("initialize", ({ params }) => {
			capabilities = params.clientCapabilities ?? {};
			return {
				protocolVersion: PROTOCOL_VERSION,
				agentCapabilities: {
					loadSession: false,
					promptCapabilities: { image: true, embeddedContext: true },
					sessionCapabilities: { close: {} },
				},
				authMethods: [
					{
						id: "knightcode-cli",
						name: "Sign in with the KnightCode CLI",
						description: "Run `knightcode` and use /login. The CLI and this agent share one credential store.",
					},
				],
				agentInfo: { name, version: options.version ?? "0.0.0" },
			};
		})
		.onRequest("authenticate", () => ({}))
		.onRequest("session/new", async ({ params }) => {
			const summary = await withEngine(() =>
				engine.createSession({
					cwd: params.cwd,
					capabilities: { readTextFile: canRead(), writeTextFile: canWrite() },
				}),
			);
			sessions.set(summary.id, { summary, state: createSessionState(summary.cwd), reads: new Map() });
			return { sessionId: summary.id, configOptions: await configOptions(summary) };
		})
		.onRequest("session/prompt", async ({ params }) => {
			const session = requireSession(params.sessionId);
			session.state.cancelling = false;
			// Parked before the call: the turn can end on the event stream before the
			// prompt's own HTTP response arrives.
			const end = new Promise<TurnEnd>((resolve, reject) => {
				session.turn = { resolve, reject };
			});
			try {
				await withEngine(() => engine.prompt(session.summary.id, toPromptInput(params.prompt)));
			} catch (error) {
				session.turn = undefined;
				throw error;
			}
			const outcome = await end.catch((error: Error) => {
				throw RequestError.internalError({ details: error.message });
			});
			if (outcome.usage) {
				await notify(session.summary.id, {
					sessionUpdate: "usage_update",
					used: outcome.usage.used ?? 0,
					size: outcome.usage.size,
					cost: { amount: outcome.usage.cost, currency: "USD" },
				});
			}
			if (outcome.stopReason === "error")
				throw RequestError.internalError({ details: outcome.error ?? "the turn failed" });
			return { stopReason: outcome.stopReason };
		})
		.onNotification("session/cancel", async ({ params }) => {
			const session = sessions.get(params.sessionId);
			if (!session) return;
			session.state.cancelling = true;
			await engine.cancel(session.summary.id).catch(() => undefined);
		})
		.onRequest("session/close", async ({ params }) => {
			const session = sessions.get(params.sessionId);
			if (!session) return {};
			sessions.delete(params.sessionId);
			settleTurn(session, { type: "session.turn_end", sessionId: params.sessionId, stopReason: "cancelled" });
			await engine.closeSession(session.summary.id).catch(() => undefined);
			return {};
		})
		.onRequest("session/set_config_option", async ({ params }) => {
			const session = requireSession(params.sessionId);
			if (typeof params.value !== "string") throw RequestError.invalidParams({ configId: params.configId });
			const patch =
				params.configId === "model"
					? { model: params.value }
					: params.configId === "thinking"
						? { thinkingLevel: params.value }
						: undefined;
			if (!patch) throw RequestError.invalidParams({ configId: params.configId }, "unknown config option");
			session.summary = await withEngine(() => engine.updateSession(session.summary.id, patch));
			return { configOptions: await configOptions(session.summary) };
		});
}
