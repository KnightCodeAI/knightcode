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
import { collapseSystemMessages, getCurrentTools } from "../utils/transcript.ts";
import {
	buildGeminiWebRequest,
	cleanTransientText,
	GeminiWebFrameParser,
	geminiWebErrorMessage,
	geminiWebQuotaMessage,
	parseGeminiWebCookies,
	readGeminiWebFrame,
} from "./gemini-web-protocol.ts";
import { GEMINI_WEB_MODEL_SELECTORS, geminiWebModelSelector } from "./gemini-web-models.ts";
import {
	GEMINI_WEB_BROWSER_HEADERS,
	mergeSessionCookies,
	readSetCookies,
	refreshGeminiWebCookies,
} from "./gemini-web-cookies.ts";
import { GeminiWebHttpError, initGeminiWebSession } from "./gemini-web-session.ts";
import {
	buildGeminiWebPrompt,
	declinedGeminiWebTools,
	GEMINI_WEB_TOOL_RETRY,
	parseGeminiWebReply,
	visibleReplyText,
} from "./gemini-web-tools.ts";
import { buildBaseOptions } from "./simple-options.ts";

let toolCallCounter = 0;

/** One StreamGenerate round trip, collected rather than streamed. Used when the first reply refuses to call tools. */
async function readGeminiWebReply(input: {
	fetch: typeof fetch;
	cookie: string;
	headers: Record<string, string>;
	signal: AbortSignal | undefined;
	maxRetries: number | undefined;
	maxRetryDelayMs: number | undefined;
	request: ReturnType<typeof buildGeminiWebRequest>;
	requestedHash?: string;
	modelName?: string;
}): Promise<{ reply?: string; completed: boolean; cookie: string }> {
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
		{ maxRetries: input.maxRetries, maxRetryDelayMs: input.maxRetryDelayMs, signal: input.signal },
	);
	const cookie = mergeSessionCookies(input.cookie, readSetCookies(response.headers));
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Gemini web returned an empty response body");
	const decoder = new TextDecoder();
	const parser = new GeminiWebFrameParser();
	let reply: string | undefined;
	let completed = false;
	const take = (parts: unknown[]) => {
		for (const part of parts) {
			const update = readGeminiWebFrame(part);
			if (!update) continue;
			if (update.errorCode === 1037 && input.modelName) throw new Error(geminiWebQuotaMessage(input.modelName));
			if (update.errorCode !== undefined) throw new Error(geminiWebErrorMessage(update.errorCode));
			if (input.requestedHash && update.modelHash && update.modelHash !== input.requestedHash) {
				throw new Error(geminiWebQuotaMessage(input.modelName ?? "The selected Gemini web model"));
			}
			completed = update.completed || completed;
			if (update.text !== undefined) reply = update.text;
		}
	};
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		take(parser.feed(decoder.decode(value, { stream: true })));
	}
	take(parser.feed(decoder.decode()));
	if (!completed) throw new Error("Gemini web ended the stream before the reply finished");
	return { reply, completed, cookie };
}

export interface GeminiWebOptions extends StreamOptions {
	thinking?: {
		enabled?: boolean;
		level?: "low" | "medium" | "high";
	};
}

/**
 * Experimental adapter for the Gemini web app, signed in with the user's own session cookies. The web app has no
 * system role, no function calling and no usage numbers: the transcript is flattened into one prompt, tools are
 * emulated with `<tool_call>` blocks, and token usage is reported as zero.
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

		try {
			if (!options?.apiKey) throw new Error(`No API key for provider: ${model.provider}`);
			let cookie = parseGeminiWebCookies(options.apiKey);
			const fetchFn = options.fetch ?? globalThis.fetch;
			const publishCookie = async (next: string) => {
				if (next === cookie) return;
				cookie = next;
				await options.onApiKeyUpdate?.(next);
			};
			const timeoutMs = options.timeoutMs ?? 60_000;
			const signal = options.signal
				? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
				: AbortSignal.timeout(timeoutMs);
			const defaultHeaders =
				providerHeadersToRecord(getIdentityHeaders(model, options.identity), model.headers, options.headers) ?? {};

			const original = cookie;
			const rotated = await refreshGeminiWebCookies({ cookie, fetch: fetchFn, signal });
			const loaded = await initGeminiWebSession({
				cookie: rotated,
				fetch: fetchFn,
				headers: defaultHeaders,
				signal,
			}).catch(async (error: unknown) => {
				if (rotated === original) throw error;
				return initGeminiWebSession({ cookie: original, fetch: fetchFn, headers: defaultHeaders, signal });
			});
			await publishCookie(loaded.cookie);
			const session = loaded.session;
			const request = buildGeminiWebRequest({
				prompt: buildGeminiWebPrompt(normalizedContext),
				session,
				reqId: 10000 + Math.floor(Math.random() * 90000),
				requestUuid: globalThis.crypto.randomUUID().toUpperCase(),
				modelId: model.id,
				thinking: options?.thinking,
			});

			const response = await retryProviderRequest(
				async () => {
					const result = await fetchFn(request.url, {
						method: "POST",
						headers: { ...defaultHeaders, ...GEMINI_WEB_BROWSER_HEADERS, ...request.headers, Cookie: cookie },
						body: request.body,
						signal,
					});
					if (!result.ok) throw new GeminiWebHttpError(result.status, result.headers);
					return result;
				},
				{ maxRetries: options.maxRetries, maxRetryDelayMs: options.maxRetryDelayMs, signal },
			);
			await publishCookie(mergeSessionCookies(cookie, readSetCookies(response.headers)));
			await options.onResponse?.(
				{ status: response.status, headers: Object.fromEntries(response.headers.entries()) },
				model,
			);

			stream.push({ type: "start", partial: output });

			let textBlock: TextContent | undefined;
			let thinkingBlock: ThinkingContent | undefined;
			let thinkingEnded = false;
			let emitted = "";
			let emittedThinking = "";
			let reply: string | undefined;
			let completed = false;

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
				if (!thinking.startsWith(emittedThinking)) return;
				const delta = thinking.slice(emittedThinking.length);
				if (!delta) return;
				if (!thinkingBlock) {
					thinkingBlock = { type: "thinking", thinking: "" };
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

			const handleParts = async (parts: unknown[]) => {
				for (const part of parts) {
					await options.onProviderStreamEvent?.(part, model);
					const update = readGeminiWebFrame(part);
					if (!update) continue;
					const requested = geminiWebModelSelector(model.id);
					const substituted =
						requested !== undefined &&
						update.modelHash !== undefined &&
						update.modelHash !== requested.hash &&
						Object.values(GEMINI_WEB_MODEL_SELECTORS).some((selector) => selector.hash === update.modelHash);
					if ((update.errorCode === 1037 && requested) || substituted) {
						const message = geminiWebQuotaMessage(model.name);
						pushVisible(message);
						throw new Error(message);
					}
					if (update.errorCode !== undefined) throw new Error(geminiWebErrorMessage(update.errorCode));
					if (update.thinking !== undefined) pushThinking(update.thinking);
					completed = update.completed || completed;
					if (update.text === undefined) continue;
					reply = update.text;
					pushVisible(visibleReplyText(completed ? reply : cleanTransientText(reply), completed));
				}
			};

			const reader = response.body?.getReader();
			if (!reader) throw new Error("Gemini web returned an empty response body");
			const decoder = new TextDecoder();
			const parser = new GeminiWebFrameParser();
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				await handleParts(parser.feed(decoder.decode(value, { stream: true })));
			}
			await handleParts(parser.feed(decoder.decode()));

			if (signal?.aborted) throw new Error("Request was aborted");
			if (reply === undefined && !thinkingBlock) throw new Error("Gemini web returned no reply");
			if (!completed) throw new Error("Gemini web ended the stream before the reply finished");
			endThinking();

			let parsed = parseGeminiWebReply(reply ?? "", () => `call_${Date.now()}_${++toolCallCounter}`);
			if (
				getCurrentTools(normalizedContext.messages).length > 0 &&
				parsed.toolCalls.length === 0 &&
				declinedGeminiWebTools(parsed.text || reply || "")
			) {
				try {
					const retry = await readGeminiWebReply({
						fetch: fetchFn,
						cookie,
						headers: defaultHeaders,
						signal,
						maxRetries: options.maxRetries,
						maxRetryDelayMs: options.maxRetryDelayMs,
						request: buildGeminiWebRequest({
							prompt: `${buildGeminiWebPrompt(normalizedContext)}\n\n${GEMINI_WEB_TOOL_RETRY}`,
							session,
							reqId: 10000 + Math.floor(Math.random() * 90000),
							requestUuid: globalThis.crypto.randomUUID().toUpperCase(),
							modelId: model.id,
							thinking: options?.thinking,
						}),
						requestedHash: geminiWebModelSelector(model.id)?.hash,
						modelName: model.name,
					});
					await publishCookie(retry.cookie);
					const retryParsed = parseGeminiWebReply(retry.reply ?? "", () => `call_${Date.now()}_${++toolCallCounter}`);
					if (retryParsed.toolCalls.length > 0) {
						reply = retry.reply;
						parsed = retryParsed;
					}
				} catch {
					// The refusal is still a finished reply. A failed retry must not discard it.
				}
			}
			if (textBlock) {
				textBlock.text = parsed.text;
				stream.push({
					type: "text_end",
					contentIndex: output.content.indexOf(textBlock),
					content: parsed.text,
					partial: output,
				});
			} else if (parsed.text) {
				textBlock = { type: "text", text: parsed.text };
				output.content.push(textBlock);
				const contentIndex = output.content.length - 1;
				stream.push({ type: "text_start", contentIndex, partial: output });
				stream.push({ type: "text_delta", contentIndex, delta: parsed.text, partial: output });
				stream.push({ type: "text_end", contentIndex, content: parsed.text, partial: output });
			}
			for (const toolCall of parsed.toolCalls) pushToolCall(stream, output, toolCall);

			output.stopReason = parsed.toolCalls.length > 0 ? "toolUse" : "stop";
			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = formatProviderError(normalizeProviderError(error));
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};

function pushToolCall(stream: AssistantMessageEventStream, output: AssistantMessage, toolCall: ToolCall): void {
	output.content.push(toolCall);
	const contentIndex = output.content.length - 1;
	stream.push({ type: "toolcall_start", contentIndex, partial: output });
	stream.push({ type: "toolcall_delta", contentIndex, delta: JSON.stringify(toolCall.arguments), partial: output });
	stream.push({ type: "toolcall_end", contentIndex, toolCall, partial: output });
}

export const streamSimple: StreamFunction<"gemini-web", SimpleStreamOptions> = (
	model: Model<"gemini-web">,
	context: TranscriptContext,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	const apiKey = options?.apiKey;
	if (!apiKey) {
		throw new Error(`No API key for provider: ${model.provider}`);
	}
	const base = buildBaseOptions(model, context, options, apiKey);
	const requested = options?.reasoning ?? (model.reasoning ? "medium" : undefined);
	const clamped = requested ? clampThinkingLevel(model, requested) : undefined;
	const level =
		clamped && clamped !== "off" && clamped !== "minimal" ? (clamped as "low" | "medium" | "high") : undefined;
	return stream(model, context, {
		...base,
		thinking: level ? { enabled: true, level } : undefined,
	});
};
