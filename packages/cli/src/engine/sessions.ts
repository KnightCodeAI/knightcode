/**
 * Engine sessions.
 *
 * One `AgentSession` per id, built the way the CLI builds its own over the
 * engine's `ModelRuntime`, so the shared credential store and the user's
 * extensions, skills and settings apply unchanged. What differs is who owns
 * the filesystem: the read, edit and write tools are replaced by
 * client-backed ones, and a hidden extension asks the client before any
 * tool that is not read-only runs.
 *
 * Every session event is published on the engine bus with its session id.
 * The ACP adapter is one subscriber; the agent manager will be another.
 */

import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import type { ThinkingLevel } from "@knightcode/agent";
import type { Api, AssistantMessage, ImageContent, Model } from "@knightcode/ai";
import { getAgentDir } from "../config.ts";
import type { AgentSession, AgentSessionEvent } from "../core/agent-session.ts";
import { createAgentSessionFromServices, createAgentSessionServices } from "../core/agent-session-services.ts";
import { emitSessionShutdownEvent } from "../core/extensions/runner.ts";
import { getDefaultSessionDir, SessionManager } from "../core/session-manager.ts";
import { resolvePath } from "../utils/paths.ts";
import { type ClientFileCapabilities, createClientFileTools } from "./client-fs.ts";
import { type ClientReply, createClientRequests } from "./client-requests.ts";
import type { EngineContext } from "./context.ts";
import type { SessionUsage, ToolContent, TurnStopReason } from "./events.ts";
import { createPermissionExtension } from "./permissions.ts";

export class SessionError extends Error {
	readonly code: "not_found" | "busy" | "auth_required" | "bad_request";

	constructor(code: SessionError["code"], message: string) {
		super(message);
		this.code = code;
	}
}

export interface SessionModelSummary {
	ref: string;
	providerId: string;
	id: string;
	name: string;
	contextWindow: number;
}

export interface SessionSummary {
	id: string;
	cwd: string;
	model?: SessionModelSummary;
	thinkingLevel: ThinkingLevel;
	thinkingLevels: ThinkingLevel[];
}

export interface CreateSessionOptions {
	cwd: string;
	model?: Model<Api>;
	/** What the client can do for the session. Absent means the tools use local disk. */
	capabilities?: Partial<ClientFileCapabilities>;
}

export interface PromptInput {
	text: string;
	images?: ImageContent[];
}

export interface SessionPatch {
	model?: Model<Api>;
	thinkingLevel?: ThinkingLevel;
}

export interface SessionRegistry {
	create(options: CreateSessionOptions): Promise<SessionSummary>;
	summary(id: string): SessionSummary | undefined;
	/** Resolves once the prompt passed preflight; the outcome is a `session.turn_end` event. */
	prompt(id: string, input: PromptInput): Promise<void>;
	cancel(id: string): Promise<boolean>;
	update(id: string, patch: SessionPatch): Promise<SessionSummary>;
	reply(id: string, requestId: string, reply: ClientReply): boolean;
	close(id: string): Promise<boolean>;
	closeAll(): Promise<void>;
	size(): number;
}

export interface CreateSessionRegistryOptions {
	/** The CLI's agent directory: settings, extensions, skills. Tests pass a temp dir. */
	agentDir?: string;
	/** Where transcripts persist. `null` keeps them in memory. Tests pass null. */
	sessionDir?: string | null;
	/**
	 * The model a session starts on when the request names none. Production
	 * leaves this unset and the CLI's default resolution applies. Tests set
	 * it: the root .env is auto-loaded with real keys, and an unpinned session
	 * would bill them on its first prompt.
	 */
	defaultModel?: Model<Api>;
}

interface Entry {
	id: string;
	cwd: string;
	session: AgentSession;
	cancelled: boolean;
	messageId: string;
	unsubscribe(): void;
}

function modelSummary(model: Model<Api> | undefined): SessionModelSummary | undefined {
	if (!model) return undefined;
	return {
		ref: `${model.provider}/${model.id}`,
		providerId: model.provider,
		id: model.id,
		name: model.name,
		contextWindow: model.contextWindow,
	};
}

function usageOf(session: AgentSession): SessionUsage | undefined {
	const context = session.getContextUsage();
	if (!context) return undefined;
	return { used: context.tokens, size: context.contextWindow, cost: session.getSessionStats().cost };
}

function contentOf(result: unknown): ToolContent[] {
	const content = typeof result === "object" && result !== null ? (result as { content?: unknown }).content : undefined;
	return Array.isArray(content) ? (content as ToolContent[]) : [];
}

function detailsOf(result: unknown): unknown {
	return typeof result === "object" && result !== null ? (result as { details?: unknown }).details : undefined;
}

/**
 * What the last assistant message says about how the turn ended. An abort
 * leaves `error` behind as often as `aborted`, so the caller consults its
 * own cancelled flag first.
 */
function stopReasonOf(session: AgentSession): { stopReason: TurnStopReason; error?: string } {
	const last = [...session.messages]
		.reverse()
		.find((message): message is AssistantMessage => message.role === "assistant");
	if (!last) return { stopReason: "end_turn" };
	if (last.stopReason === "length") return { stopReason: "max_tokens" };
	if (last.stopReason === "error" || last.stopReason === "aborted") {
		return { stopReason: "error", error: last.errorMessage ?? "the turn failed" };
	}
	return { stopReason: "end_turn" };
}

export function createSessionRegistry(ctx: EngineContext, options: CreateSessionRegistryOptions = {}): SessionRegistry {
	const entries = new Map<string, Entry>();
	const requests = createClientRequests(ctx.events);
	const agentDir = options.agentDir ?? getAgentDir();

	function get(id: string): Entry {
		const entry = entries.get(id);
		if (!entry) throw new SessionError("not_found", `unknown session: ${id}`);
		return entry;
	}

	function summarize(entry: Entry): SessionSummary {
		const { session } = entry;
		return {
			id: entry.id,
			cwd: entry.cwd,
			model: modelSummary(session.model),
			thinkingLevel: session.thinkingLevel,
			thinkingLevels: session.getAvailableThinkingLevels(),
		};
	}

	function forward(entry: Entry, event: AgentSessionEvent): void {
		const sessionId = entry.id;
		switch (event.type) {
			case "message_start":
				if (event.message.role !== "assistant") return;
				entry.messageId = randomUUID();
				ctx.events.publish({ type: "session.message", sessionId, messageId: entry.messageId });
				return;
			case "message_update": {
				const inner = event.assistantMessageEvent;
				if (inner.type === "text_delta" || inner.type === "thinking_delta") {
					ctx.events.publish({
						type: "session.delta",
						sessionId,
						messageId: entry.messageId,
						kind: inner.type === "text_delta" ? "text" : "thinking",
						delta: inner.delta,
					});
				} else if (inner.type === "toolcall_end") {
					ctx.events.publish({
						type: "session.tool_call",
						sessionId,
						toolCallId: inner.toolCall.id,
						toolName: inner.toolCall.name,
						args: inner.toolCall.arguments,
					});
				}
				return;
			}
			case "tool_execution_start":
				ctx.events.publish({
					type: "session.tool_start",
					sessionId,
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					args: event.args,
				});
				return;
			case "tool_execution_update":
				ctx.events.publish({
					type: "session.tool_update",
					sessionId,
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					content: contentOf(event.partialResult),
					details: detailsOf(event.partialResult),
				});
				return;
			case "tool_execution_end":
				ctx.events.publish({
					type: "session.tool_end",
					sessionId,
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					content: contentOf(event.result),
					details: detailsOf(event.result),
					isError: event.isError,
				});
				return;
			default:
				return;
		}
	}

	function finishTurn(entry: Entry, error?: unknown): void {
		// Closed mid-turn: the closed event already went out and nobody waits for this one.
		if (entries.get(entry.id) !== entry) return;
		const outcome = entry.cancelled
			? { stopReason: "cancelled" as const }
			: error !== undefined
				? { stopReason: "error" as const, error: error instanceof Error ? error.message : String(error) }
				: stopReasonOf(entry.session);
		ctx.events.publish({ type: "session.turn_end", sessionId: entry.id, ...outcome, usage: usageOf(entry.session) });
	}

	async function close(id: string): Promise<boolean> {
		const entry = entries.get(id);
		if (!entry) return false;
		entries.delete(id);
		entry.cancelled = true;
		requests.abortAll(id, "closed");
		entry.unsubscribe();
		// Same order as AgentSessionRuntime.teardownCurrent: settle the turn, tell
		// extensions, then dispose.
		await entry.session.abort();
		await emitSessionShutdownEvent(entry.session.extensionRunner, { type: "session_shutdown", reason: "quit" });
		entry.session.dispose();
		ctx.events.publish({ type: "session.closed", sessionId: id });
		return true;
	}

	return {
		async create(request) {
			const cwd = resolvePath(request.cwd);
			const stats = await stat(cwd).catch(() => undefined);
			if (!stats?.isDirectory()) throw new SessionError("bad_request", `cwd is not a directory: ${request.cwd}`);
			const capabilities: ClientFileCapabilities = {
				readTextFile: request.capabilities?.readTextFile === true,
				writeTextFile: request.capabilities?.writeTextFile === true,
			};
			const sessionManager =
				options.sessionDir === null
					? SessionManager.inMemory(cwd)
					: SessionManager.create(cwd, options.sessionDir ?? getDefaultSessionDir(cwd, agentDir));
			const id = sessionManager.getSessionId();
			const services = await createAgentSessionServices({
				cwd,
				agentDir,
				modelRuntime: ctx.models,
				resourceLoaderOptions: { extensionFactories: [createPermissionExtension(id, requests)] },
			});
			const { session } = await createAgentSessionFromServices({
				services,
				sessionManager,
				model: request.model ?? options.defaultModel,
				customTools: createClientFileTools(services.cwd, id, requests, capabilities, {
					autoResizeImages: services.settingsManager.getImageAutoResize(),
				}),
			});
			if (!session.model) {
				session.dispose();
				throw new SessionError("auth_required", "no model is available; sign in first");
			}
			const entry: Entry = { id, cwd: services.cwd, session, cancelled: false, messageId: "", unsubscribe: () => {} };
			entry.unsubscribe = session.subscribe((event) => forward(entry, event));
			entries.set(id, entry);
			ctx.events.publish({ type: "session.created", sessionId: id, cwd: services.cwd });
			return summarize(entry);
		},

		summary(id) {
			const entry = entries.get(id);
			return entry ? summarize(entry) : undefined;
		},

		async prompt(id, input) {
			const entry = get(id);
			const { session } = entry;
			if (session.isStreaming) throw new SessionError("busy", "the session is already running a turn");
			const model = session.model;
			if (!model) throw new SessionError("auth_required", "no model selected");
			// The check prompt() makes at agent-session.ts:1266-1282, made here so
			// the failure is a status code rather than a message to match on.
			if (!ctx.models.hasConfiguredAuth(model.provider) && (await ctx.models.checkAuth(model.provider)) === undefined) {
				throw new SessionError("auth_required", `not signed in to ${model.provider}`);
			}
			entry.cancelled = false;
			let started = false;
			await new Promise<void>((resolve, reject) => {
				session
					.prompt(input.text, {
						images: input.images,
						source: "rpc",
						preflightResult: (ok) => {
							if (!ok) return;
							started = true;
							resolve();
						},
					})
					.then(() => finishTurn(entry))
					.catch((error: unknown) => {
						if (started) finishTurn(entry, error);
						else reject(error);
					});
			});
		},

		async cancel(id) {
			const entry = entries.get(id);
			if (!entry) return false;
			entry.cancelled = true;
			requests.abortAll(id, "cancelled");
			await entry.session.abort();
			return true;
		},

		async update(id, patch) {
			const entry = get(id);
			if (patch.model) {
				try {
					await entry.session.setModel(patch.model);
				} catch (error) {
					throw new SessionError("auth_required", error instanceof Error ? error.message : String(error));
				}
			}
			if (patch.thinkingLevel) entry.session.setThinkingLevel(patch.thinkingLevel);
			return summarize(entry);
		},

		reply(id, requestId, reply) {
			get(id);
			return requests.reply(id, requestId, reply);
		},

		close,

		async closeAll() {
			for (const id of [...entries.keys()]) await close(id);
		},

		size: () => entries.size,
	};
}
