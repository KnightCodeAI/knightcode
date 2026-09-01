import { afterEach, describe, expect, it, vi } from "vitest";
import { getModel, getModels, streamSimple } from "../src/compat.ts";
import { findEnvKeys, getEnvApiKey } from "../src/env-api-keys.ts";
import type { Api, FetchFunction, Model } from "../src/types.ts";

const ANTHROPIC_MODEL_IDS = ["claude-opus-4-8", "claude-opus-5"] as const;
const OPENAI_MODEL_IDS = ["deepseek-v4-flash", "glm-5.3", "gpt-5.6-sol"] as const;
const ALL_MODEL_IDS = [...ANTHROPIC_MODEL_IDS, ...OPENAI_MODEL_IDS] as const;

// Pinned deliberately: AgentRouter publishes no cache ratios, so these are chosen
// constants in generate-models.ts, not fetched values. See docs/agentrouterplan.md.
const CACHE_READ_RATIO = 0.1;
const CACHE_WRITE_RATIO = 1.25;

const originalAgentRouterApiKey = process.env.AGENTROUTER_API_KEY;

afterEach(() => {
	if (originalAgentRouterApiKey === undefined) {
		delete process.env.AGENTROUTER_API_KEY;
	} else {
		process.env.AGENTROUTER_API_KEY = originalAgentRouterApiKey;
	}
	vi.unstubAllGlobals();
});

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
	it("registers every model AgentRouter publishes", () => {
		const modelIds = getModels("agentrouter").map((model) => model.id);
		expect(modelIds.sort()).toEqual([...ALL_MODEL_IDS].sort());
	});

	it.each(ANTHROPIC_MODEL_IDS)("routes %s through the Anthropic Messages endpoint", (modelId) => {
		expect(getModel("agentrouter", modelId)).toMatchObject({
			provider: "agentrouter",
			api: "anthropic-messages",
			baseUrl: "https://agentrouter.org",
		});
	});

	it.each(OPENAI_MODEL_IDS)("routes %s through the OpenAI-compatible endpoint", (modelId) => {
		expect(getModel("agentrouter", modelId)).toMatchObject({
			provider: "agentrouter",
			api: "openai-completions",
			baseUrl: "https://agentrouter.org/v1",
		});
	});

	// models.dev carries no `cost` for the agentrouter provider, so the generator's usual
	// `m.cost?.input || 0` fallback would ship a silent $0 catalog. This is the guard.
	// Assert relationships, never literal dollars — prices are fetched live at generation time.
	it.each(ALL_MODEL_IDS)("prices %s from AgentRouter's own rate table", (modelId) => {
		const { cost } = getModel("agentrouter", modelId);

		expect(cost.input).toBeGreaterThan(0);
		expect(cost.output).toBeGreaterThan(0);
		expect(cost.output).toBeGreaterThanOrEqual(cost.input);
	});

	it.each(ALL_MODEL_IDS)("derives %s cache costs from the pinned ratios", (modelId) => {
		const { cost } = getModel("agentrouter", modelId);

		expect(cost.cacheRead).toBeCloseTo(cost.input * CACHE_READ_RATIO, 5);
		expect(cost.cacheWrite).toBeCloseTo(cost.input * CACHE_WRITE_RATIO, 5);
	});

	it("keeps Claude models on adaptive thinking without temperature", () => {
		for (const modelId of ANTHROPIC_MODEL_IDS) {
			const model = getModel("agentrouter", modelId);
			expect(model.compat).toMatchObject({ forceAdaptiveThinking: true, supportsTemperature: false });
			expect(model.thinkingLevelMap).toMatchObject({ xhigh: "xhigh", max: "max" });
		}
	});

	// Without "agentrouter" in the deepseek-v4 branch of applyThinkingLevelMetadata this
	// model would get the non-flash map, which marks "low" unsupported.
	it("gives DeepSeek V4 Flash its own thinking levels", () => {
		expect(getModel("agentrouter", "deepseek-v4-flash").thinkingLevelMap).toMatchObject({
			low: "low",
			high: "high",
			max: "max",
		});
	});

	// AgentRouter rejects unlisted clients before auth, so the allowlisted User-Agent has to
	// survive onto the wire and beat the KnightCode one both APIs seed by default.
	it.each([...ANTHROPIC_MODEL_IDS, ...OPENAI_MODEL_IDS])("presents an allowlisted client for %s", async (modelId) => {
		const request = await captureRequest(getModel("agentrouter", modelId));

		expect(request.headers.get("user-agent")).toBe("claude-cli/2.1.75 (external, cli)");
	});

	// AgentRouter relays DeepSeek unnormalized: without these it sends `role: "developer"` and
	// `max_completion_tokens`, which the upstream rejected with a 400 on 2026-09-01.
	it("keeps DeepSeek V4 Flash on DeepSeek's wire format", () => {
		expect(getModel("agentrouter", "deepseek-v4-flash").compat).toMatchObject({
			supportsDeveloperRole: false,
			maxTokensField: "max_tokens",
			requiresReasoningContentOnAssistantMessages: true,
			thinkingFormat: "deepseek",
		});
	});

	// Its GLM and GPT relays do normalize to standard OpenAI shape — both verified live —
	// so they must not inherit z.ai's or OpenAI-direct's quirks.
	it("leaves GLM 5.3 on the standard OpenAI wire format", () => {
		const model = getModel("agentrouter", "glm-5.3");

		expect(model.compat?.thinkingFormat ?? "openai").toBe("openai");
		expect(model.compat?.supportsDeveloperRole ?? true).toBe(true);
	});

	it("sends Anthropic-shaped requests to the Messages endpoint", async () => {
		const request = await captureRequest(getModel("agentrouter", "claude-opus-5"));

		expect(request.url).toBe("https://agentrouter.org/v1/messages");
		expect(request.headers.get("x-api-key")).toBe("test-agentrouter-key");
		expect(await request.clone().json()).toMatchObject({ model: "claude-opus-5" });
	});

	it("sends OpenAI-shaped requests to the completions endpoint", async () => {
		const request = await captureRequest(getModel("agentrouter", "gpt-5.6-sol"));

		expect(request.url).toBe("https://agentrouter.org/v1/chat/completions");
		expect(request.headers.get("authorization")).toBe("Bearer test-agentrouter-key");
		expect(await request.clone().json()).toMatchObject({ model: "gpt-5.6-sol" });
	});

	it("resolves AGENTROUTER_API_KEY from the environment", () => {
		process.env.AGENTROUTER_API_KEY = "test-agentrouter-key";

		expect(findEnvKeys("agentrouter")).toEqual(["AGENTROUTER_API_KEY"]);
		expect(getEnvApiKey("agentrouter")).toBe("test-agentrouter-key");
	});
});
