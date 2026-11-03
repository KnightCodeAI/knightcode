import { clampThinkingLevel } from "../models.ts";
import type {
	Api,
	AssistantMessage,
	Model,
	SimpleStreamOptions,
	StreamFunction,
	StreamOptions,
	TextContent,
	ThinkingContent,
	ToolCall,
	TranscriptContext,
} from "../types.ts";
import { formatProviderError, normalizeProviderError } from "../utils/error-body.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { providerHeadersToRecord } from "../utils/headers.ts";
import { getIdentityHeaders } from "../utils/identity.ts";
import { retryProviderRequest } from "../utils/provider-retry.ts";
import { ToolCallArgumentsStream } from "../utils/streaming-json.ts";
import { collapseSystemMessages, getCurrentTools } from "../utils/transcript.ts";
import { prepareGeminiWebConversation } from "./gemini-web-conversation.ts";
import {
	GEMINI_WEB_BROWSER_HEADERS,
	mergeSessionCookies,
	readSetCookies,
	refreshGeminiWebCookies,
} from "./gemini-web-cookies.ts";
import { geminiWebModelSelector } from "./gemini-web-models.ts";
import {
	buildGeminiWebRequest,
	canContinueGeminiWebConversation,
	cleanTransientText,
	type GeminiWebConversation,
	type GeminiWebFrameUpdate,
	GeminiWebFrameParser,
	geminiWebErrorMessage,
	geminiWebQuotaMessage,
	isGeminiWebErrorReply,
	parseGeminiWebCookies,
	readGeminiWebFrame,
} from "./gemini-web-protocol.ts";
import { GeminiWebHttpError, GeminiWebSessionWaitError, initGeminiWebSession } from "./gemini-web-session.ts";
import {
	buildGeminiWebPrompt,
	declinedGeminiWebTools,
	delegatedGeminiWebEdits,
	GEMINI_WEB_TOOL_RETRY,
	GEMINI_WEB_TOOL_FORMAT_RETRY,
	parseGeminiWebReply,
	readGeminiWebToolCallProgress,
	visibleReplyText,
} from "./gemini-web-tools.ts";
import { buildBaseOptions } from "./simple-options.ts";

const SESSION_TOKEN_TTL_MS = 5 * 60_000;
const GENERIC_REPLY_RECOVERY =
	"The previous web reply failed before any of its tool calls executed. Resume the user's task from the confirmed tool results in the transcript above. Do not repeat successful operations. Use the listed tools for unfinished work, respecting all system instructions and permission limits. If the work is complete, summarize only verified results.";

let toolCallCounter = 0;

class GeminiWebQuotaError extends Error {}

class GeminiWebRecoveryError extends Error {
	constructor() {
		super(
			"Gemini web could not complete this reply after one recovery attempt. Earlier confirmed tool results are preserved. Try again later or choose another provider.",
		);
	}
}

class GeminiWebToolFormatError extends Error {
	constructor() {
		super(
			"Gemini web returned invalid tool-call JSON and its recovery budget is exhausted. No tool calls from this reply were executed. Earlier confirmed tool results are preserved.",
		);
	}
}

class GeminiWebProtocolError extends Error {
	code: number;

	constructor(code: number) {
		super(geminiWebErrorMessage(code));
		this.code = code;
	}
}

/** One StreamGenerate reply, shared by normal turns and the single recovery attempt. */
async function readGeminiWebReply(input: {
	fetch: typeof fetch;
	cookie: string;
	headers: Record<string, string>;
	signal: AbortSignal;
	options: GeminiWebOptions;
	model: Model<"gemini-web">;
	request: ReturnType<typeof buildGeminiWebRequest>;
	conversation?: GeminiWebConversation;
	onCookie: (cookie: string) => Promise<void>;
	onStart: () => void;
	onUpdate: (update: GeminiWebFrameUpdate, completed: boolean) => void;
	onQuota: (message: string) => void;
}): Promise<{ reply: string; conversation: GeminiWebConversation }> {
	const response = await retryProviderRequest(
		async () => {
			const result = await input.fetch(input.request.url, {
				method: "POST",
				headers: {
					...input.headers,
					...GEMINI_WEB_BROWSER_HEADERS,
					...input.request.headers,
					Cookie: input.cookie,
				},
				body: input.request.body,
				signal: input.signal,
			});
			if (!result.ok) throw new GeminiWebHttpError(result.status, result.headers);
			return result;
		},
		{ maxRetries: input.options.maxRetries, maxRetryDelayMs: input.options.maxRetryDelayMs, signal: input.signal },
	);
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Gemini web returned an empty response body");
	const decoder = new TextDecoder();
	const parser = new GeminiWebFrameParser();
	const conversation = input.conversation ? [...input.conversation] : new Array<string | null>(10).fill(null);
	let reply: string | undefined;
	let completed = false;
	let finished = false;
	let hasThinking = false;
	const take = async (parts: unknown[]) => {
		for (const part of parts) {
			await input.options.onProviderStreamEvent?.(part, input.model);
			const update = readGeminiWebFrame(part);
			if (!update) continue;
			const requested = geminiWebModelSelector(input.model.id);
			if (
				requested &&
				(update.errorCode === 1037 || (update.modelHash !== undefined && update.modelHash !== requested.hash))
			) {
				const message = geminiWebQuotaMessage(input.model.name);
				input.onQuota(message);
				throw new GeminiWebQuotaError(message);
			}
			if (update.errorCode !== undefined) throw new GeminiWebProtocolError(update.errorCode);
			for (const [index, value] of (update.conversation ?? []).entries()) {
				if (value !== null) conversation[index] = value;
			}
			completed = update.completed || completed;
			if (update.text !== undefined) reply = update.text;
			if (update.thinking) hasThinking = true;
			input.onUpdate(update, completed);
		}
	};
	try {
		await input.onCookie(mergeSessionCookies(input.cookie, readSetCookies(response.headers)));
		await input.options.onResponse?.(
			{ status: response.status, headers: Object.fromEntries(response.headers.entries()) },
			input.model,
		);
		input.onStart();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				finished = true;
				break;
			}
			await take(parser.feed(decoder.decode(value, { stream: true })));
		}
		await take(parser.feed(decoder.decode()));
		input.signal.throwIfAborted();
		if (reply === undefined && !hasThinking) throw new Error("Gemini web returned no reply");
		if (!completed) throw new Error("Gemini web ended the stream before the reply finished");
		return { reply: reply ?? "", conversation };
	} finally {
		if (!finished) await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}

export interface GeminiWebOptions extends StreamOptions {
	/** Shorten older bulky tool outputs on cold replays; never modifies local history. Default: "compact". */
	historyReplay?: "compact" | "full";
	thinking?: {
		enabled?: boolean;
		level?: "low" | "medium" | "high";
	};
}

/**
 * Experimental Gemini web adapter. Temporary conversations are reused in memory when sessionId is supplied;
 * tools are emulated with <tool_call> blocks. Google exposes no usage or cache counters, so these stay zero.
 */
export const stream: StreamFunction<"gemini-web", GeminiWebOptions> = (
	model: Model<"gemini-web">,
	context: TranscriptContext,
	options?: GeminiWebOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();
	const normalizedContext = collapseSystemMessages(context);

	(async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: "gemini-web" as Api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "pending",
			timestamp: Date.now(),
		};

		let deadline: AbortSignal | undefined;
		try {
			if (!options?.apiKey) throw new Error(`No API key for provider: ${model.provider}`);
			let cookie = parseGeminiWebCookies(options.apiKey);
			const fullPrompt = () => buildGeminiWebPrompt(normalizedContext, 0, options.historyReplay !== "full");
			const prepared = prepareGeminiWebConversation({
				context: normalizedContext,
				cookie,
				model: JSON.stringify([model.provider, model.id, options.thinking, options.historyReplay]),
				sessionId: options.cacheRetention === "none" ? undefined : options.sessionId,
				compactHistory: options.historyReplay !== "full",
			});
			const fetchFn = options.fetch ?? globalThis.fetch;
			const publishCookie = async (next: string) => {
				if (next === cookie) return;
				cookie = next;
				await options.onApiKeyUpdate?.(next);
			};
			// Argon can spend several minutes thinking. Match the other adapters instead of aborting at 60 seconds.
			const timeoutMs = options.timeoutMs ?? 600_000;
			deadline = AbortSignal.timeout(timeoutMs);
			const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
			const defaultHeaders =
				providerHeadersToRecord(getIdentityHeaders(model, options.identity), model.headers, options.headers) ?? {};

			const loadSession = async (nextCookie: string, fallbackCookie?: string) => {
				const loaded = await initGeminiWebSession({
					cookie: nextCookie,
					fetch: fetchFn,
					headers: defaultHeaders,
					signal,
				}).catch(async (error: unknown) => {
					if (
						signal.aborted ||
						error instanceof GeminiWebSessionWaitError ||
						!fallbackCookie ||
						nextCookie === fallbackCookie
					)
						throw error;
					return initGeminiWebSession({ cookie: fallbackCookie, fetch: fetchFn, headers: defaultHeaders, signal });
				});
				return { ...loaded, expiresAt: Date.now() + SESSION_TOKEN_TTL_MS };
			};
			const rotated = await refreshGeminiWebCookies({ cookie, fetch: fetchFn, signal });
			const cached = prepared.bootstrap?.cookie === rotated ? prepared.bootstrap : undefined;
			let loaded = cached ?? (await loadSession(rotated, cookie));
			let canRefreshCachedSession = cached !== undefined;
			await publishCookie(loaded.cookie);

			let started = false;
			let textBlock: TextContent | undefined;
			let thinkingBlock: ThinkingContent | undefined;
			let thinkingEnded = false;
			let emitted = "";
			let emittedThinking = "";
			const pendingTools: { call: ToolCall; arguments: ToolCallArgumentsStream }[] = [];
			const endThinking = () => {
				if (!thinkingBlock || thinkingEnded) return;
				thinkingEnded = true;
				stream.push({
					type: "thinking_end",
					contentIndex: output.content.indexOf(thinkingBlock),
					content: thinkingBlock.thinking,
					partial: output,
				});
			};
			const pushThinking = (thinking: string) => {
				if (!thinking || thinking === emittedThinking) return;
				const delta = thinking.startsWith(emittedThinking) ? thinking.slice(emittedThinking.length) : `\n\n${thinking}`;
				if (!thinkingBlock || thinkingEnded) {
					thinkingBlock = { type: "thinking", thinking: "" };
					thinkingEnded = false;
					output.content.push(thinkingBlock);
					stream.push({ type: "thinking_start", contentIndex: output.content.length - 1, partial: output });
				}
				thinkingBlock.thinking += delta;
				emittedThinking = thinking;
				stream.push({
					type: "thinking_delta",
					contentIndex: output.content.indexOf(thinkingBlock),
					delta,
					partial: output,
				});
			};
			const pushVisible = (visible: string) => {
				if (!visible.startsWith(emitted)) return;
				const delta = visible.slice(emitted.length);
				if (!delta) return;
				endThinking();
				if (!textBlock) {
					textBlock = { type: "text", text: "" };
					output.content.push(textBlock);
					stream.push({ type: "text_start", contentIndex: output.content.length - 1, partial: output });
				}
				textBlock.text += delta;
				emitted = visible;
				stream.push({ type: "text_delta", contentIndex: output.content.indexOf(textBlock), delta, partial: output });
			};
			const pushToolProgress = (reply: string) => {
				for (const [index, progress] of readGeminiWebToolCallProgress(reply).entries()) {
					let pending = pendingTools[index];
					if (!pending) {
						endThinking();
						const call: ToolCall = {
							type: "toolCall",
							id: `call_${Date.now()}_${++toolCallCounter}`,
							name: progress.name,
							arguments: {},
						};
						pending = { call, arguments: new ToolCallArgumentsStream() };
						pendingTools.push(pending);
						output.content.push(call);
						stream.push({ type: "toolcall_start", contentIndex: output.content.length - 1, partial: output });
					}
					if (pending.call.name !== progress.name) {
						// Web candidates can replace their draft. Only the completed reply may decide what executes.
						pending.call.name = progress.name;
						pending.call.arguments = {};
						pending.arguments = new ToolCallArgumentsStream();
						stream.push({
							type: "toolcall_delta",
							contentIndex: output.content.indexOf(pending.call),
							delta: "",
							partial: output,
						});
					}
					if (progress.argumentsText === undefined) continue;
					const update = pending.arguments.replace(progress.argumentsText);
					pending.call.arguments = update.arguments;
					if (update.delta !== "") {
						stream.push({
							type: "toolcall_delta",
							contentIndex: output.content.indexOf(pending.call),
							delta: update.delta ?? "",
							partial: output,
						});
					}
				}
			};
			const generate = async (prompt: string, conversation?: GeminiWebConversation, recovery = false) => {
				signal.throwIfAborted();
				const read = () =>
					readGeminiWebReply({
						fetch: fetchFn,
						cookie,
						headers: defaultHeaders,
						signal,
						options,
						model,
						conversation,
						request: buildGeminiWebRequest({
							prompt,
							session: loaded.session,
							conversation,
							reqId: 10000 + Math.floor(Math.random() * 90000),
							requestUuid: globalThis.crypto.randomUUID().toUpperCase(),
							modelId: model.id,
							thinking: options.thinking,
						}),
						onCookie: publishCookie,
						onStart: () => {
							if (started) return;
							started = true;
							stream.push({ type: "start", partial: output });
						},
						onUpdate: (update, completed) => {
							if (update.thinking !== undefined) pushThinking(update.thinking);
							if (update.text === undefined) return;
							if (!recovery && !isGeminiWebErrorReply(update.text, true)) {
								pushVisible(visibleReplyText(completed ? update.text : cleanTransientText(update.text), completed));
							}
							pushToolProgress(update.text);
						},
						onQuota: pushVisible,
					});
				try {
					return await read();
				} catch (error) {
					// Only a cached page token and an explicit HTTP rejection permit one token refresh. Never retry
					// a quota response, a broken stream, or a request the user cancelled.
					if (
						!canRefreshCachedSession ||
						signal.aborted ||
						!(error instanceof GeminiWebHttpError) ||
						![400, 401, 403].includes(error.status)
					)
						throw error;
					canRefreshCachedSession = false;
					loaded = await loadSession(cookie);
					await publishCookie(loaded.cookie);
					return read();
				}
			};

			let result;
			// Conversation repair, a stock failure, and tool correction share one extra generation budget.
			let recoveryUsed = false;
			try {
				result = await generate(prepared.prompt, prepared.metadata);
			} catch (error) {
				// A rejected continuation can be expired upstream. Only this explicit rejection permits one fresh chat.
				if (
					!prepared.metadata ||
					!(error instanceof GeminiWebProtocolError) ||
					error.code !== 1050 ||
					output.content.length
				) {
					throw error;
				}
				recoveryUsed = true;
				result = await generate(fullPrompt());
			}
			if (isGeminiWebErrorReply(result.reply)) {
				if (recoveryUsed) throw new GeminiWebRecoveryError();
				recoveryUsed = true;
				pendingTools.length = 0;
				// A stock failure can mean the upstream chat is no longer usable. Do not continue or cache it;
				// resend confirmed history in a fresh temporary chat, without replaying any tool executions.
				result = await generate(`${fullPrompt()}\n\n${GENERIC_REPLY_RECOVERY}`, undefined, true);
				if (isGeminiWebErrorReply(result.reply)) throw new GeminiWebRecoveryError();
			}
			let toolIndex = 0;
			const nextId = () => pendingTools[toolIndex++]?.call.id ?? `call_${Date.now()}_${++toolCallCounter}`;
			let parsed = parseGeminiWebReply(result.reply, nextId);
			const delegatedEdits =
				parsed.toolCalls.length === 0 && delegatedGeminiWebEdits(normalizedContext, parsed.text || result.reply);
			const declinedTools = parsed.toolCalls.length === 0 && declinedGeminiWebTools(parsed.text || result.reply);
			const malformedTools = parsed.toolCalls.some((call) => call.argumentsError !== undefined);
			if (recoveryUsed && declinedTools) throw new GeminiWebRecoveryError();
			if (recoveryUsed && malformedTools) throw new GeminiWebToolFormatError();
			let canSave = true;
			if (
				!recoveryUsed &&
				getCurrentTools(normalizedContext.messages).length > 0 &&
				(malformedTools ||
					(parsed.toolCalls.length === 0 && (declinedTools || delegatedEdits || pendingTools.length > 0)))
			) {
				recoveryUsed = true;
				// A new generation gets new provisional ids. Preserve earlier partial objects for queued consumers;
				// stale draft blocks are excluded from the separate, authoritative final message below.
				pendingTools.length = 0;
				try {
					// Continue the same chat when possible; older web responses may omit continuation metadata.
					const reusable = canContinueGeminiWebConversation(result.conversation);
					const correction = malformedTools ? GEMINI_WEB_TOOL_FORMAT_RETRY : GEMINI_WEB_TOOL_RETRY;
					const retry = await generate(
						reusable ? correction : `${fullPrompt()}\n\n${correction}`,
						reusable ? result.conversation : undefined,
						true,
					);
					if (isGeminiWebErrorReply(retry.reply)) throw new GeminiWebRecoveryError();
					toolIndex = 0;
					const retryParsed = parseGeminiWebReply(retry.reply, nextId);
					if (
						retryParsed.toolCalls.some((call) => call.argumentsError !== undefined) ||
						(malformedTools && retryParsed.toolCalls.length === 0)
					)
						throw new GeminiWebToolFormatError();
					if (retryParsed.toolCalls.length > 0) {
						result = retry;
						parsed = retryParsed;
					} else canSave = false;
				} catch (error) {
					if (
						signal.aborted ||
						malformedTools ||
						pendingTools.length > 0 ||
						error instanceof GeminiWebToolFormatError ||
						error instanceof GeminiWebRecoveryError ||
						error instanceof GeminiWebQuotaError ||
						(error instanceof GeminiWebProtocolError && error.code === 1037) ||
						(error instanceof GeminiWebHttpError && error.status === 429)
					)
						throw error;
					canSave = false;
					// The refusal is still a finished reply. A failed recovery must not discard it.
				}
			}
			if (delegatedEdits && parsed.toolCalls.length === 0) {
				throw new Error(
					"Gemini web did not issue a tool call for the requested file changes after one corrective attempt. No edits were executed by this reply.",
				);
			}
			endThinking();
			if (!textBlock && parsed.text) pushVisible(parsed.text);
			if (textBlock) textBlock.text = parsed.text;
			// Never execute a call that only appeared in a draft. A separate final message also leaves the content
			// indices of earlier shared partials valid for consumers still processing their toolcall_start events.
			const finalized: AssistantMessage = {
				...output,
				content: output.content.filter((block) => block.type !== "toolCall"),
			};
			if (textBlock) {
				stream.push({
					type: "text_end",
					contentIndex: finalized.content.indexOf(textBlock),
					content: parsed.text,
					partial: finalized,
				});
			}
			for (const toolCall of parsed.toolCalls) {
				const pending = pendingTools.find((tool) => tool.call.id === toolCall.id);
				const call = pending?.call ?? toolCall;
				Object.assign(call, toolCall);
				finalized.content.push(call);
				const contentIndex = finalized.content.length - 1;
				if (!pending) stream.push({ type: "toolcall_start", contentIndex, partial: finalized });
				if (!pending?.arguments.text) {
					stream.push({
						type: "toolcall_delta",
						contentIndex,
						delta: JSON.stringify(call.arguments),
						partial: finalized,
					});
				}
				stream.push({ type: "toolcall_end", contentIndex, toolCall: call, partial: finalized });
			}
			finalized.stopReason = parsed.toolCalls.length > 0 ? "toolUse" : "stop";
			if (canSave) prepared.save(finalized, result.conversation, { ...loaded, cookie });
			stream.push({ type: "done", reason: finalized.stopReason, message: finalized });
			stream.end();
		} catch (error) {
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			// A full-deadline failure has already spent several minutes. Do not let the agent automatically repeat
			// the same expensive replay up to three more times. Keep this wording outside transient-error patterns.
			output.errorMessage =
				deadline?.aborted &&
				!options?.signal?.aborted &&
				(error === deadline.reason ||
					(error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")))
					? "Gemini web exceeded the request's waiting limit. This attempt was stopped without automatic repeats. Shorten the chat, lower thinking effort, or choose another provider. Earlier confirmed tool results are preserved."
					: formatProviderError(normalizeProviderError(error));
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};

export const streamSimple: StreamFunction<"gemini-web", SimpleStreamOptions> = (
	model: Model<"gemini-web">,
	context: TranscriptContext,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	const apiKey = options?.apiKey;
	if (!apiKey) throw new Error(`No API key for provider: ${model.provider}`);
	const base = buildBaseOptions(model, context, options, apiKey);
	const requested = options?.reasoning ?? (model.reasoning ? "medium" : undefined);
	const clamped = requested ? clampThinkingLevel(model, requested) : undefined;
	const level =
		clamped && clamped !== "off" && clamped !== "minimal" ? (clamped as "low" | "medium" | "high") : undefined;
	return stream(model, context, {
		...base,
		onApiKeyUpdate: options?.onApiKeyUpdate,
		thinking: level ? { enabled: true, level } : undefined,
	});
};
