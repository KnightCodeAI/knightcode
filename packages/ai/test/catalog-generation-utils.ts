import { writeFileSync } from "node:fs";
import type { ModelsDevV2Catalog } from "../catalog/sources/models-dev.ts";

// One priced AgentRouter model with its models.dev entry, so AgentRouter builds from the live rate table
// instead of warning and falling back to the committed catalog.
const AGENTROUTER_MODELS_DEV: ModelsDevV2Catalog = {
	agentrouter: {
		models: {
			"glm-5.3": {
				id: "glm-5.3",
				type: "chat",
				name: "GLM 5.3",
				modalities: { input: ["text"], output: ["text"] },
				capabilities: { tools: { supported: true }, reasoning: { supported: false } },
				limit: { context: 200000, output: 32000 },
				api: {},
			},
		},
	},
};

/**
 * Write a `node --import` preload that serves every upstream catalog the
 * generator fetches: the given models.dev v2 catalog, and minimal responses for
 * the other sources. `overrides` replaces responses by URL. Any other request fails.
 */
export function writeUpstreamMock(
	preloadPath: string,
	modelsDev: ModelsDevV2Catalog,
	overrides: Record<string, unknown> = {},
): void {
	const responses = {
		"https://models.dev/experimental/v2.0/api.json": { ...AGENTROUTER_MODELS_DEV, ...modelsDev },
		"https://models.dev/models.json?type=decision": {
			"typesafe/jev-latest": { id: "typesafe/jev-latest", name: "Jev", type: "decision", limit: { context: 64000 } },
		},
		"https://openrouter.ai/api/v1/models": { data: [] },
		"https://openrouter.ai/api/v1/models?output_modalities=image": {
			data: [
				{
					id: "test/image",
					name: "Test Image",
					architecture: { input_modalities: ["text"], output_modalities: ["image"] },
					pricing: {},
				},
			],
		},
		"https://openrouter.ai/api/v1/models?output_modalities=decisions": { data: [] },
		"https://ai-gateway.vercel.sh/v1/models": { data: [] },
		"https://agentrouter.org/api/status": { data: { quota_per_unit: 500000 } },
		"https://agentrouter.org/api/pricing": {
			group_ratio: { default: 1 },
			data: [{ model_name: "glm-5.3", quota_type: 0, model_ratio: 1, completion_ratio: 1 }],
		},
		"https://radius.pi.dev/v1/config": {
			baseUrl: "https://radius.pi.dev",
			models: [
				{
					id: "test",
					name: "Test",
					reasoning: false,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 4096,
					maxTokens: 4096,
				},
			],
		},
		...overrides,
	};
	writeFileSync(
		preloadPath,
		`const responses = ${JSON.stringify(responses)};\n` +
			`globalThis.fetch = async (input) => {\n` +
			`  const url = String(input);\n` +
			`  if (url in responses) return Response.json(responses[url]);\n` +
			`  throw new Error(\`Unexpected fetch: \${url}\`);\n` +
			`};\n`,
	);
}
