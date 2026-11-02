import * as fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCatalog } from "../catalog/build.ts";
import agentrouterCatalog from "../catalog/providers/agentrouter.ts";
import type { CatalogSources } from "../catalog/sources/index.ts";
import type { ModelsDevV2Model } from "../catalog/sources/models-dev.ts";
import { getModel, getModels, streamSimple } from "../src/compat.ts";
import { findEnvKeys, getEnvApiKey } from "../src/env-api-keys.ts";
import type { Api, FetchFunction, Model } from "../src/types.ts";

vi.mock("node:fs", { spy: true });

const ANTHROPIC_MODEL_IDS = ["claude-opus-4-8", "claude-opus-5"] as const;
const COMPLETIONS_MODEL_IDS = ["deepseek-v4-flash", "glm-5.3"] as const;
const RESPONSES_MODEL_IDS = ["gpt-5.6-sol", "gpt-6-astra", "gpt-6.1-sol"] as const;
const ALL_MODEL_IDS = [...ANTHROPIC_MODEL_IDS, ...COMPLETIONS_MODEL_IDS, ...RESPONSES_MODEL_IDS] as const;

// Pinned deliberately: AgentRouter publishes no cache ratios, so these are chosen
// constants in catalog/providers/agentrouter.ts, not fetched values.
const CACHE_READ_RATIO = 0.1;
const CACHE_WRITE_RATIO = 1.25;

const originalAgentRouterApiKey = process.env.AGENTROUTER_API_KEY;

afterEach(() => {
	if (originalAgentRouterApiKey === undefined) {
		delete process.env.AGENTROUTER_API_KEY;
	} else {
		process.env.AGENTROUTER_API_KEY = originalAgentRouterApiKey;
	}
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

// Controlled upstream data keeps routing coverage when AgentRouter stops listing a model.
function catalogSources(): CatalogSources {
	const models: Record<string, ModelsDevV2Model> = {};
	for (const id of ALL_MODEL_IDS) {
		models[id] = {
			id,
			type: "chat",
			name: id,
			modalities: { input: ["text", "image"], output: ["text"] },
			capabilities: { tools: { supported: true }, reasoning: { supported: true } },
			limit: { context: 200000, output: 32000 },
			api: id.startsWith("claude-")
				? { messages: { base_url: "https://agentrouter.org", sdk: { aisdk: "@ai-sdk/anthropic" } } }
				: {},
		};
	}
	return {
		modelsDev: { agentrouter: { models } },
		modelsDevDecisions: {},
		openRouter: { chat: [], images: [], classifiers: [] },
		aiGateway: { chat: [], classifiers: [] },
		nvidiaModelIds: new Map(),
		radius: [],
		agentRouter: {
			rates: {
				quotaPerUnit: 500000,
				groupRatio: 1,
				models: ALL_MODEL_IDS.map((id) => ({
					model_name: id,
					quota_type: 0,
					model_ratio: 2,
					completion_ratio: 5,
					supported_endpoint_types: id.startsWith("claude-") ? ["anthropic"] : ["openai"],
				})),
			},
		},
	};
}

function fixtureModel(id: string): Model<Api> {
	const models = buildCatalog([agentrouterCatalog], catalogSources(), true).agentrouter.chat;
	const model = models.find((entry) => entry.id === id);
	if (!model) throw new Error(`Missing fixture model: ${id}`);
	return model;
}

/** Captures the outgoing request without letting it reach the network. */
async function captureRequest(model: Model<Api>): Promise<Request> {
	const ambient = vi.fn<FetchFunction>(async () => {
		throw new Error("ambient fetch must not be called");
	});
	vi.stubGlobal("fetch", ambient);

	let captured: Request | undefined;
	const capture = vi.fn<FetchFunction>(async (input, init) => {
		captured = new Request(input, init);
		return new Response(JSON.stringify({ error: { message: "captured" } }), {
			status: 401,
			headers: { "content-type": "application/json" },
		});
	});

	await streamSimple(
		model,
		{ messages: [{ role: "user", content: "test", timestamp: 0 }] },
		{ apiKey: "test-agentrouter-key", fetch: capture, maxRetries: 0 },
	).result();

	expect(ambient).not.toHaveBeenCalled();
	if (!captured) throw new Error("no request captured");
	return captured;
}

describe("AgentRouter models", () => {
	it("registers every tool-capable model in the rate table", () => {
		const models = buildCatalog([agentrouterCatalog], catalogSources(), true).agentrouter.chat;
		expect(models.map((model) => model.id).sort()).toEqual([...ALL_MODEL_IDS].sort());
	});

	it.each(RESPONSES_MODEL_IDS)("includes %s in the generated catalog with Responses routing", (modelId) => {
		expect(getModels("agentrouter").map((model) => model.id)).toContain(modelId);
		expect(getModel("agentrouter", modelId)).toMatchObject({
			api: "openai-responses",
			baseUrl: "https://agentrouter.org/v1",
		});
	});

	it.each(ANTHROPIC_MODEL_IDS)("routes %s through the Anthropic Messages endpoint", (modelId) => {
		expect(fixtureModel(modelId)).toMatchObject({
			provider: "agentrouter",
			api: "anthropic-messages",
			baseUrl: "https://agentrouter.org",
		});
	});

	it.each(COMPLETIONS_MODEL_IDS)("routes %s through the Chat Completions endpoint", (modelId) => {
		expect(fixtureModel(modelId)).toMatchObject({
			provider: "agentrouter",
			api: "openai-completions",
			baseUrl: "https://agentrouter.org/v1",
		});
	});

	it.each(RESPONSES_MODEL_IDS)("routes %s from the live rate table through Responses", (modelId) => {
		expect(fixtureModel(modelId)).toMatchObject({
			api: "openai-responses",
			baseUrl: "https://agentrouter.org/v1",
		});
	});

	it.each(RESPONSES_MODEL_IDS)("corrects stale Chat Completions routing for %s in committed data", (modelId) => {
		const staleModel = { ...fixtureModel(modelId), api: "openai-completions" };
		vi.spyOn(fs, "readFileSync").mockReturnValueOnce(
			JSON.stringify({ "openai-completions": { [`chat:${modelId}`]: staleModel } }),
		);
		const sources = catalogSources();
		sources.agentRouter = { failure: "pricing endpoint unavailable" };
		const models = buildCatalog([agentrouterCatalog], sources, true).agentrouter.chat;

		expect(models).toHaveLength(1);
		expect(models[0]).toMatchObject({
			id: modelId,
			api: "openai-responses",
			baseUrl: "https://agentrouter.org/v1",
		});
	});

	// models.dev carries no cost for this provider; prices must come from AgentRouter.
	it.each(ALL_MODEL_IDS)("prices %s from AgentRouter's own rate table", (modelId) => {
		const { cost } = fixtureModel(modelId);
		expect(cost.input).toBe(4);
		expect(cost.output).toBe(20);
	});

	it.each(ALL_MODEL_IDS)("derives %s cache costs from the pinned ratios", (modelId) => {
		const { cost } = fixtureModel(modelId);
		expect(cost.cacheRead).toBeCloseTo(cost.input * CACHE_READ_RATIO, 5);
		expect(cost.cacheWrite).toBeCloseTo(cost.input * CACHE_WRITE_RATIO, 5);
	});

	it("keeps Claude models on adaptive thinking without temperature", () => {
		for (const modelId of ANTHROPIC_MODEL_IDS) {
			const model = fixtureModel(modelId);
			expect(model.compat).toMatchObject({ forceAdaptiveThinking: true, supportsTemperature: false });
			expect(model.thinkingLevelMap).toMatchObject({ xhigh: "xhigh", max: "max" });
		}
	});

	// DeepSeek V4 Flash needs its own map rather than the non-flash model's map.
	it("gives DeepSeek V4 Flash its own thinking levels", () => {
		expect(fixtureModel("deepseek-v4-flash").thinkingLevelMap).toMatchObject({
			low: "low",
			high: "high",
			max: "max",
		});
	});

	// AgentRouter rejects unlisted clients before auth; all three APIs must retain this header.
	it.each(ALL_MODEL_IDS)("presents an allowlisted client for %s", async (modelId) => {
		const request = await captureRequest(fixtureModel(modelId));
		expect(request.headers.get("user-agent")).toBe("claude-cli/2.1.75 (external, cli)");
	});

	it("keeps DeepSeek V4 Flash on DeepSeek's wire format", () => {
		expect(fixtureModel("deepseek-v4-flash").compat).toMatchObject({
			supportsDeveloperRole: false,
			maxTokensField: "max_tokens",
			requiresReasoningContentOnAssistantMessages: true,
			thinkingFormat: "deepseek",
		});
	});

	it("leaves the GPT relay on the standard OpenAI wire format", () => {
		const model = fixtureModel("gpt-6-astra");
		expect(model.compat).toMatchObject({ supportsStrictMode: true });
		expect(model.compat).not.toHaveProperty("thinkingFormat");
		expect(model.compat).not.toMatchObject({ supportsDeveloperRole: false });
	});

	it("sends Anthropic-shaped requests to the Messages endpoint", async () => {
		const request = await captureRequest(fixtureModel("claude-opus-5"));
		expect(new URL(request.url).pathname).toBe("/v1/messages");
		expect(request.headers.get("x-api-key")).toBe("test-agentrouter-key");
		expect(await request.clone().json()).toMatchObject({ model: "claude-opus-5" });
	});

	it("sends DeepSeek requests to the Chat Completions endpoint", async () => {
		const request = await captureRequest(fixtureModel("deepseek-v4-flash"));
		expect(request.url).toBe("https://agentrouter.org/v1/chat/completions");
		expect(request.headers.get("authorization")).toBe("Bearer test-agentrouter-key");
		expect(await request.clone().json()).toMatchObject({ model: "deepseek-v4-flash", messages: expect.any(Array) });
	});

	it.each(RESPONSES_MODEL_IDS)(
		"sends generated %s requests to Responses with bearer authentication",
		async (modelId) => {
			const request = await captureRequest(getModel("agentrouter", modelId));
			expect(request.url).toBe("https://agentrouter.org/v1/responses");
			expect(request.headers.get("authorization")).toBe("Bearer test-agentrouter-key");
			expect(request.headers.get("user-agent")).toBe("claude-cli/2.1.75 (external, cli)");
			expect(await request.clone().json()).toMatchObject({ model: modelId, input: expect.any(Array) });
		},
	);

	it("resolves AGENTROUTER_API_KEY from the environment", () => {
		process.env.AGENTROUTER_API_KEY = "test-agentrouter-key";
		expect(findEnvKeys("agentrouter")).toEqual(["AGENTROUTER_API_KEY"]);
		expect(getEnvApiKey("agentrouter")).toBe("test-agentrouter-key");
	});
});
