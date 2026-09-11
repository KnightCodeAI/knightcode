/**
 * Completion routes.
 *
 * Seam 2 (Cmd+K in a buffer, Cmd+K in the terminal, commit messages) uses
 * /v1/chat/completions; seam 3 (Tab prediction) uses /v1/completions. Both are
 * OpenAI-shaped so the Rust side reuses Zed's existing client shapes.
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Api, Model } from "@knightcode/ai";
import type { EngineContext } from "./context.ts";
import { OpenAIRequestError, parseChatRequest, toChunk, toContext } from "./openai.ts";
import { type EngineRoute, sendJson } from "./server.ts";

const MAX_BODY_BYTES = 4 * 1024 * 1024;

async function readJson(req: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = chunk as Buffer;
		size += buffer.length;
		if (size > MAX_BODY_BYTES) throw new OpenAIRequestError("body too large");
		chunks.push(buffer);
	}
	if (chunks.length === 0) return {};
	return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

export class ModelLookupError extends Error {
	readonly status: number;
	readonly code: string;
	readonly candidates: readonly string[];

	constructor(status: number, code: string, message: string, candidates: readonly string[] = []) {
		super(message);
		this.status = status;
		this.code = code;
		this.candidates = candidates;
	}
}

/**
 * Resolve a model reference to exactly one catalog entry.
 *
 * A bare model id is not unique: `claude-opus-5` is offered by both `anthropic`
 * and `agentrouter` on the same machine, and picking the first match silently
 * bills the wrong account through the wrong endpoint. `/v1/models` therefore
 * returns a `ref` of the form `<providerId>/<modelId>` for clients to send
 * verbatim.
 *
 * A bare id still resolves when it is unambiguous, because that is what a
 * hand-written curl or a generic OpenAI client will send. When it is ambiguous
 * the engine refuses and names the candidates rather than guessing.
 */
export function resolveModel(ctx: EngineContext, ref: string): Model<Api> {
	if (ref.length === 0) throw new ModelLookupError(400, "bad_request", "model is required");

	// Split on the first separator only: OpenRouter ids contain slashes of their
	// own, e.g. openrouter/anthropic/claude-3-haiku.
	const separator = ref.indexOf("/");
	if (separator > 0) {
		const providerId = ref.slice(0, separator);
		const modelId = ref.slice(separator + 1);
		const qualified = ctx.models.getModel(providerId, modelId);
		if (qualified) return qualified;
	}

	const matches: Model<Api>[] = [];
	for (const provider of ctx.models.getProviders()) {
		const model = ctx.models.getModel(provider.id, ref);
		if (model) matches.push(model);
	}
	if (matches.length === 1) return matches[0];
	if (matches.length === 0) throw new ModelLookupError(404, "unknown_model", `unknown model: ${ref}`);
	throw new ModelLookupError(
		409,
		"ambiguous_model",
		`model ${ref} is offered by more than one provider; qualify it as <providerId>/${ref}`,
		matches.map((model) => `${model.provider}/${model.id}`),
	);
}

export function sendLookupError(res: ServerResponse, error: unknown): void {
	if (error instanceof ModelLookupError) {
		sendJson(res, error.status, {
			error: error.code,
			message: error.message,
			...(error.candidates.length > 0 ? { candidates: error.candidates } : {}),
		});
		return;
	}
	sendJson(res, 500, { error: "internal", message: error instanceof Error ? error.message : String(error) });
}

export function completionsRoutes(ctx: EngineContext): readonly EngineRoute[] {
	return [
		{
			method: "POST",
			path: "/v1/chat/completions",
			handle: async (req, res) => {
				let request;
				try {
					request = parseChatRequest(await readJson(req));
				} catch (error) {
					sendJson(res, 400, { error: "bad_request", message: error instanceof Error ? error.message : "invalid" });
					return;
				}

				let model: Model<Api>;
				try {
					model = resolveModel(ctx, request.model);
				} catch (error) {
					sendLookupError(res, error);
					return;
				}

				// Without a signal the provider request runs to completion even after
				// the editor gives up, and the user is billed for output nobody reads.
				const controller = new AbortController();
				req.on("close", () => controller.abort());

				const id = `chatcmpl-${randomUUID()}`;
				const stream = ctx.models.stream(model, toContext(request, model), {
					maxTokens: request.max_tokens,
					temperature: request.temperature,
					signal: controller.signal,
				});

				if (!request.stream) {
					let content = "";
					let finishReason = "stop";
					for await (const event of stream) {
						if (event.type === "text_delta") content += event.delta;
						else if (event.type === "done") {
							finishReason = toChunk(event, id, request.model)?.choices[0].finish_reason ?? "stop";
						} else if (event.type === "error") {
							if (!res.writableEnded) {
								sendJson(res, 502, { error: "upstream", message: event.error.errorMessage ?? "stream failed" });
							}
							return;
						}
					}
					if (res.writableEnded) return;
					sendJson(res, 200, {
						id,
						object: "chat.completion",
						created: Math.floor(Date.now() / 1000),
						model: request.model,
						choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finishReason }],
					});
					return;
				}

				res.writeHead(200, {
					"content-type": "text/event-stream",
					"cache-control": "no-cache, no-transform",
					connection: "keep-alive",
					"x-accel-buffering": "no",
				});

				let failure: string | undefined;
				for await (const event of stream) {
					if (controller.signal.aborted) break;
					if (event.type === "error") {
						failure = event.error.errorMessage ?? "stream failed";
						break;
					}
					const chunk = toChunk(event, id, request.model);
					if (chunk) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
				}

				if (controller.signal.aborted) {
					res.end();
					return;
				}
				if (failure !== undefined) {
					// Headers are already sent, so the status cannot say 502. Emit an
					// error event instead of [DONE]: a client that sees [DONE] treats a
					// truncated answer as complete and may apply it to the buffer.
					res.write(`event: error\ndata: ${JSON.stringify({ error: "upstream", message: failure })}\n\n`);
					res.end();
					return;
				}
				res.write("data: [DONE]\n\n");
				res.end();
			},
		},
		{
			method: "POST",
			path: "/v1/completions",
			handle: async (req, res) => {
				let body: Record<string, unknown>;
				try {
					const parsed = await readJson(req);
					body = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
				} catch (error) {
					sendJson(res, 400, { error: "bad_request", message: error instanceof Error ? error.message : "invalid" });
					return;
				}

				const ref = typeof body.model === "string" ? body.model : "";
				const prompt = typeof body.prompt === "string" ? body.prompt : "";
				const suffix = typeof body.suffix === "string" ? body.suffix : "";
				// Edit prediction sends a small max_tokens to bound latency. Ignoring
				// it lets the model run to model.maxTokens — tens of thousands of
				// tokens on every keystroke.
				const maxTokens = typeof body.max_tokens === "number" ? body.max_tokens : undefined;
				const temperature = typeof body.temperature === "number" ? body.temperature : undefined;

				let model: Model<Api>;
				try {
					model = resolveModel(ctx, ref);
				} catch (error) {
					sendLookupError(res, error);
					return;
				}

				// Tab prediction is superseded on the next keystroke, so an abandoned
				// request must stop rather than run to completion.
				const controller = new AbortController();
				req.on("close", () => controller.abort());

				const context = toContext(
					{
						model: ref,
						messages: [
							{
								role: "system",
								content:
									"Complete the code between PREFIX and SUFFIX. Reply with the completion text only, no fences, no commentary.",
							},
							{ role: "user", content: `PREFIX:\n${prompt}\nSUFFIX:\n${suffix}` },
						],
					},
					model,
				);

				let text = "";
				for await (const event of ctx.models.stream(model, context, {
					maxTokens,
					temperature,
					signal: controller.signal,
				})) {
					if (event.type === "text_delta") text += event.delta;
					else if (event.type === "error") {
						if (!res.writableEnded) {
							sendJson(res, 502, { error: "upstream", message: event.error.errorMessage ?? "stream failed" });
						}
						return;
					}
				}
				if (res.writableEnded || controller.signal.aborted) return;
				sendJson(res, 200, {
					id: `cmpl-${randomUUID()}`,
					object: "text_completion",
					created: Math.floor(Date.now() / 1000),
					model: ref,
					choices: [{ index: 0, text, finish_reason: "stop" }],
				});
			},
		},
	];
}
