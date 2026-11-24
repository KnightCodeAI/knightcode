import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildOpenRouterCatalog, type OpenRouterModelListItem } from "../catalog/sources/openrouter.ts";
import { generateImages } from "../src/images.ts";
import type { ImageModel, ImagesContext } from "../src/types.ts";

const mockState = vi.hoisted(() => ({
	lastParams: undefined as unknown,
	lastRequestOptions: undefined as unknown,
	lastPost: undefined as { path: string; body: unknown } | undefined,
}));

vi.mock("openai", () => {
	class FakeOpenAI {
		post(path: string, options: { body: unknown }) {
			mockState.lastPost = { path, body: options.body };
			const data = {
				created: 1748372400,
				data: [{ b64_json: "ZmFrZS1qcGVn", media_type: "image/jpeg" }],
				usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46, cost: 0.04 },
			};
			return { withResponse: async () => ({ data, response: { status: 200, headers: new Headers() } }) };
		}
		chat = {
			completions: {
				create: (params: unknown, requestOptions?: unknown) => {
					mockState.lastParams = params;
					mockState.lastRequestOptions = requestOptions;
					const signal = (requestOptions as { signal?: AbortSignal } | undefined)?.signal;
					if (signal?.aborted) {
						const error = new Error("Request aborted");
						return {
							withResponse: async () => {
								throw error;
							},
						};
					}
					const response = {
						id: "img-1",
						usage: {
							prompt_tokens: 12,
							completion_tokens: 34,
							prompt_tokens_details: { cached_tokens: 0 },
						},
						choices: [
							{
								message: {
									content: "Here is your image.",
									images: [{ image_url: "data:image/png;base64,ZmFrZS1wbmc=" }],
								},
							},
						],
					};
					const promise = Promise.resolve(response) as Promise<typeof response> & {
						withResponse: () => Promise<{
							data: typeof response;
							response: { status: number; headers: Headers };
						}>;
					};
					promise.withResponse = async () => ({
						data: response,
						response: { status: 200, headers: new Headers() },
					});
					return promise;
				},
			},
		};
	}

	return { default: FakeOpenAI };
});

const flux = {
	id: "black-forest-labs/flux-3-image",
	name: "FLUX 3 Image",
	architecture: { input_modalities: ["text", "image"], output_modalities: ["image"] },
	endpoints: ["/api/v1/images"],
} satisfies OpenRouterModelListItem;

describe("openrouter images", () => {
	beforeEach(() => {
		mockState.lastParams = undefined;
		mockState.lastRequestOptions = undefined;
		mockState.lastPost = undefined;
	});

	it("returns text plus images in final output", async () => {
		const model: ImageModel<"openrouter-images"> = {
			type: "image",
			id: "google/gemini-3.1-flash-image-preview",
			name: "Gemini 3.1 Flash Image Preview",
			api: "openrouter-images",
			provider: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			input: ["text", "image"],
			output: ["text", "image"],
			cost: { input: 0.015, output: 0.03, cacheRead: 0, cacheWrite: 0 },
			headers: { "HTTP-Referer": "https://example.com" },
		};
		const context: ImagesContext = {
			input: [{ type: "text", text: "Generate a dog" }],
		};

		const output = await generateImages(model, context, { apiKey: "test" });
		expect(output.stopReason).toBe("stop");
		expect(output.responseId).toBe("img-1");
		expect(output.output[0]).toMatchObject({ type: "text", text: "Here is your image." });
		expect(output.output[1]).toMatchObject({ type: "image", mimeType: "image/png", data: "ZmFrZS1wbmc=" });

		const params = mockState.lastParams as {
			stream?: boolean;
			modalities?: string[];
			messages?: [{ content?: [{ type: string; text?: string }] }];
		};
		expect(params.stream).toBe(false);
		expect(params.modalities).toEqual(["image", "text"]);
		expect(params.messages?.[0]?.content?.[0]).toMatchObject({ type: "text", text: "Generate a dog" });
	});

	it("passes through abort signal and returns aborted result", async () => {
		const model: ImageModel<"openrouter-images"> = {
			type: "image",
			id: "black-forest-labs/flux.2-pro",
			name: "FLUX.2 Pro",
			api: "openrouter-images",
			provider: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			input: ["text", "image"],
			output: ["image"],
			cost: { input: 0.015, output: 0.03, cacheRead: 0, cacheWrite: 0 },
		};
		const context: ImagesContext = {
			input: [{ type: "text", text: "Generate a dog" }],
		};
		const controller = new AbortController();
		controller.abort();

		const output = await generateImages(model, context, { apiKey: "test", signal: controller.signal });
		expect(output.stopReason).toBe("aborted");
		expect(output.errorMessage).toBe("Request aborted");
		expect(mockState.lastRequestOptions).toMatchObject({ signal: controller.signal });
	});

	it("generateImages resolves the final assistant images result", async () => {
		const model: ImageModel<"openrouter-images"> = {
			type: "image",
			id: "black-forest-labs/flux.2-pro",
			name: "FLUX.2 Pro",
			api: "openrouter-images",
			provider: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			input: ["text", "image"],
			output: ["image"],
			cost: { input: 0.015, output: 0.03, cacheRead: 0, cacheWrite: 0 },
		};
		const context: ImagesContext = {
			input: [{ type: "text", text: "Generate a dog" }],
		};

		const output = await generateImages(model, context, { apiKey: "test" });
		expect(output.output.some((item) => item.type === "image")).toBe(true);
		// Image-only models must not request text output.
		expect((mockState.lastParams as { modalities?: string[] }).modalities).toEqual(["image"]);
	});

	it("generates a FLUX image without sending it to chat completions", async () => {
		const [model] = buildOpenRouterCatalog([], [flux], []).images;
		const result = await generateImages(
			model,
			{
				input: [
					{ type: "text", text: "Add a dog" },
					{ type: "image", mimeType: "image/png", data: "ZmFrZS1wbmc=" },
				],
			},
			{ apiKey: "test" },
		);

		expect(result.errorMessage).toBeUndefined();
		expect(result).toMatchObject({
			stopReason: "stop",
			output: [{ type: "image", mimeType: "image/jpeg", data: "ZmFrZS1qcGVn" }],
			usage: { input: 12, output: 34, totalTokens: 46, cost: { total: 0.04, totalFromProvider: true } },
		});
		expect(mockState.lastParams).toBeUndefined();
		expect(mockState.lastPost?.path).toBe("/images");
		expect(mockState.lastPost?.body).toEqual({
			model: flux.id,
			prompt: "Add a dog",
			response_format: "b64_json",
			input_references: [{ type: "image_url", image_url: { url: "data:image/png;base64,ZmFrZS1wbmc=" } }],
		});
	});
});
