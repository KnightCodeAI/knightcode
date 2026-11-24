import { describe, expect, it, vi } from "vitest";
import { buildOpenRouterCatalog, type OpenRouterModelListItem } from "../catalog/sources/openrouter.ts";
import { generateImages } from "../src/images.ts";

const flux = {
	id: "black-forest-labs/flux-3-image",
	name: "FLUX 3 Image",
	architecture: { input_modalities: ["text", "image"], output_modalities: ["image"] },
	endpoints: ["/api/v1/images"],
} satisfies OpenRouterModelListItem;

describe("OpenRouter dedicated image endpoint", () => {
	it("generates a FLUX image without sending it to chat completions", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
			if (String(url) !== "https://openrouter.ai/api/v1/images") {
				return Response.json(
					{
						error: {
							code: 404,
							message: `${flux.id} cannot be used with the chat/completions endpoint. Use the /api/v1/images endpoint instead.`,
						},
					},
					{ status: 404 },
				);
			}
			return Response.json({
				created: 1748372400,
				data: [{ b64_json: "ZmFrZS1qcGVn", media_type: "image/jpeg" }],
				usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46, cost: 0.04 },
			});
		});

		const [model] = buildOpenRouterCatalog([], [flux], []).images;
		const result = await generateImages(
			model,
			{
				input: [
					{ type: "text", text: "Add a dog" },
					{ type: "image", mimeType: "image/png", data: "ZmFrZS1wbmc=" },
				],
			},
			{ apiKey: "test", fetch },
		);

		expect(result.errorMessage).toBeUndefined();
		expect(result).toMatchObject({
			stopReason: "stop",
			output: [{ type: "image", mimeType: "image/jpeg", data: "ZmFrZS1qcGVn" }],
			usage: { input: 12, output: 34, totalTokens: 46, cost: { total: 0.04, totalFromProvider: true } },
		});
		expect(fetch).toHaveBeenCalledTimes(1);
		const [url, init] = fetch.mock.calls[0];
		expect(String(url)).toBe("https://openrouter.ai/api/v1/images");
		expect(init?.method).toBe("POST");
		expect(JSON.parse(String(init?.body))).toEqual({
			model: flux.id,
			prompt: "Add a dog",
			response_format: "b64_json",
			input_references: [{ type: "image_url", image_url: { url: "data:image/png;base64,ZmFrZS1wbmc=" } }],
		});
	});
});
