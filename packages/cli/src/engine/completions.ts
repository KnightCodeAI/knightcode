/**
 * Completion routes.
 *
 * Seam 2 (Cmd+K in a buffer, Cmd+K in the terminal, commit messages) uses
 * /v1/chat/completions; seam 3 (Tab prediction) uses /v1/completions. Both are
 * OpenAI-shaped so the Rust side reuses Zed's existing client shapes.
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
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

function findModel(ctx: EngineContext, modelId: string): Model<Api> | undefined {
	for (const provider of ctx.models.getProviders()) {
		const model = ctx.models.getModel(provider.id, modelId);
		if (model) return model;
	}
	return undefined;
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

				const model = findModel(ctx, request.model);
				if (!model) {
					sendJson(res, 404, { error: "unknown_model", model: request.model });
					return;
				}

				const id = `chatcmpl-${randomUUID()}`;
				const stream = ctx.models.stream(model, toContext(request, model), {
					maxTokens: request.max_tokens,
					temperature: request.temperature,
				});

				if (!request.stream) {
					let content = "";
					let finishReason = "stop";
					for await (const event of stream) {
						if (event.type === "text_delta") content += event.delta;
						else if (event.type === "done") {
							finishReason = toChunk(event, id, request.model)?.choices[0].finish_reason ?? "stop";
						} else if (event.type === "error") {
							sendJson(res, 502, { error: "upstream", message: event.error.errorMessage ?? "stream failed" });
							return;
						}
					}
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
				// A client that navigates away mid-completion must not leave the
				// upstream request running.
				let aborted = false;
				req.on("close", () => {
					aborted = true;
				});
				for await (const event of stream) {
					if (aborted) break;
					if (event.type === "error") break;
					const chunk = toChunk(event, id, request.model);
					if (chunk) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
				}
				if (!aborted) res.write("data: [DONE]\n\n");
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

				const modelId = typeof body.model === "string" ? body.model : "";
				const prompt = typeof body.prompt === "string" ? body.prompt : "";
				const suffix = typeof body.suffix === "string" ? body.suffix : "";
				// Edit prediction sends a small max_tokens to bound latency. Ignoring
				// it lets the model run to model.maxTokens — tens of thousands of
				// tokens on every keystroke.
				const maxTokens = typeof body.max_tokens === "number" ? body.max_tokens : undefined;
				const temperature = typeof body.temperature === "number" ? body.temperature : undefined;
				const model = findModel(ctx, modelId);
				if (!model) {
					sendJson(res, 404, { error: "unknown_model", model: modelId });
					return;
				}

				const context = toContext(
					{
						model: modelId,
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
				for await (const event of ctx.models.stream(model, context, { maxTokens, temperature })) {
					if (event.type === "text_delta") text += event.delta;
					else if (event.type === "error") {
						sendJson(res, 502, { error: "upstream", message: event.error.errorMessage ?? "stream failed" });
						return;
					}
				}
				sendJson(res, 200, {
					id: `cmpl-${randomUUID()}`,
					object: "text_completion",
					created: Math.floor(Date.now() / 1000),
					model: modelId,
					choices: [{ index: 0, text, finish_reason: "stop" }],
				});
			},
		},
	];
}
