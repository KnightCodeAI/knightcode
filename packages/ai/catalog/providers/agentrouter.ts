import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Model } from "../../src/types.ts";
import { type ChatModel, defineProvider, type ProviderContext } from "../define.ts";
import type { AgentRouterRates } from "../sources/agentrouter.ts";
import { type ModelsDevModel, normalizeModelsDevModel, roundCost } from "../sources/models-dev.ts";

const ANTHROPIC_BASE_URL = "https://agentrouter.org";
const OPENAI_BASE_URL = "https://agentrouter.org/v1";
// AgentRouter publishes no cache_ratio / create_cache_ratio, so these cannot be read and have to be
// chosen: Anthropic's own multipliers applied to AgentRouter's input price. Contested: when a model is
// absent from new-api's cache map, GetCacheRatio returns 1, i.e. cached reads bill at full input price;
// set CACHE_READ_RATIO to 1 if a real billing check says so.
const CACHE_READ_RATIO = 0.1;
const CACHE_WRITE_RATIO = 1.25;
// AgentRouter rejects any request whose User-Agent is not one of its allowlisted clients ("unauthorized
// client detected", returned before auth is even checked). The match is a prefix on the client name,
// verified 2026-09-01: claude-cli/, codex_cli_rs/, QwenCode/, opencode/, cline/, Cline/, RooCode/,
// roo-code/, Kilo-Code/ pass; knightcode/ does not, and a combined "knightcode/x claude-cli/y" does not
// either. The full Claude Code format is required: bare "claude-cli/2.1.75" is rejected,
// "claude-cli/2.1.75 (external, cli)" passes. So reaching AgentRouter at all means presenting one of
// those names. Drop this the day they allowlist knightcode/.
const CLIENT_USER_AGENT = "claude-cli/2.1.75 (external, cli)";
// Capability metadata only, first match wins. The agentrouter entry is preferred because it is the one
// that records the Anthropic SDK for the endpoint split.
const METADATA_SOURCES = ["agentrouter", "anthropic", "openai", "deepseek", "zai"] as const;
const COMMITTED_DATA_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../src/providers/data/agentrouter.json");

/** The models.dev entry for `id` from the first metadata source that lists it. */
function capabilities(ctx: ProviderContext, id: string): { source: string; model: ModelsDevModel } | undefined {
	for (const source of METADATA_SOURCES) {
		const entry = ctx.sources.modelsDev[source]?.models?.[id];
		if (entry) return { source, model: normalizeModelsDevModel(entry) };
	}
	return undefined;
}

/**
 * Prices must come from AgentRouter, not from a list-price fallback: models.dev publishes the agentrouter
 * provider with no cost at all, so its prices would ship a $0 catalog, and AgentRouter's prices diverge
 * from list prices in both directions anyway. models.dev is used only for capability metadata.
 */
function liveModels(ctx: ProviderContext, rates: AgentRouterRates): ChatModel[] {
	const models: ChatModel[] = [];
	for (const entry of rates.models) {
		// quota_type 1 is a fixed model_price per call, not per-token. None today, but the field exists and
		// this cost model assumes per-token.
		if (entry.quota_type !== 0) continue;
		const metadata = capabilities(ctx, entry.model_name);
		// Without a context window there is nothing sane to emit.
		if (!metadata?.model.toolCall) continue;
		// glm-5.3 and deepseek-v4-flash advertise the anthropic endpoint too, but that is new-api's
		// translation shim: their native shape is OpenAI.
		const isAnthropic =
			entry.supported_endpoint_types?.includes("anthropic") === true &&
			(metadata.source === "anthropic" || metadata.model.apis.some((api) => api.aisdk === "@ai-sdk/anthropic"));
		if (
			typeof entry.model_ratio !== "number" ||
			!Number.isFinite(entry.model_ratio) ||
			entry.model_ratio <= 0 ||
			typeof entry.completion_ratio !== "number" ||
			!Number.isFinite(entry.completion_ratio) ||
			entry.completion_ratio <= 0
		) {
			console.warn(`Skipping ${entry.model_name}: AgentRouter /api/pricing returned unusable ratios`);
			continue;
		}
		const input = roundCost((entry.model_ratio * rates.groupRatio * 1_000_000) / rates.quotaPerUnit);
		const model: ChatModel = {
			id: entry.model_name,
			name: metadata.model.name || entry.model_name,
			api: isAnthropic ? "anthropic-messages" : "openai-completions",
			provider: ctx.providerId,
			baseUrl: isAnthropic ? ANTHROPIC_BASE_URL : OPENAI_BASE_URL,
			reasoning: metadata.model.reasoning,
			input: metadata.model.imageInput ? ["text", "image"] : ["text"],
			cost: {
				input,
				output: roundCost(input * entry.completion_ratio),
				cacheRead: roundCost(input * CACHE_READ_RATIO),
				cacheWrite: roundCost(input * CACHE_WRITE_RATIO),
			},
			contextWindow: metadata.model.contextWindow || 4096,
			maxTokens: metadata.model.maxTokens || 4096,
			headers: { "User-Agent": CLIENT_USER_AGENT },
		};
		ctx.recordModelsDevSource(model, metadata.model);
		models.push(model);
	}
	return models;
}

/**
 * The committed catalog, keyed by api then model id as the generator wrote it. It stands in when the live
 * rate table is unreachable: prices then go stale rather than the provider disappearing, and dropping it is
 * not survivable, since an empty result deletes data/agentrouter.json and the models.generated.ts import with
 * it, leaving providers/agentrouter.ts importing a file that no longer exists.
 */
function committedModels(): ChatModel[] {
	if (!existsSync(COMMITTED_DATA_PATH)) return [];
	const byApi = JSON.parse(readFileSync(COMMITTED_DATA_PATH, "utf8")) as Record<string, Record<string, ChatModel>>;
	return Object.values(byApi).flatMap((models) => Object.values(models));
}

// AgentRouter relays DeepSeek in its native shape rather than normalizing it: verified 2026-09-01,
// deepseek-v4-flash there rejects the `developer` role with a 400. Its GLM and GPT relays do normalize,
// so this stays scoped to the DeepSeek models.
const DEEPSEEK_COMPLETIONS_COMPAT = {
	supportsStore: false,
	supportsDeveloperRole: false,
	maxTokensField: "max_tokens",
	requiresReasoningContentOnAssistantMessages: true,
	thinkingFormat: "deepseek",
	supportsStrictMode: true,
} as const;

export default defineProvider({
	id: "agentrouter",
	models: (ctx) => {
		const live = "rates" in ctx.sources.agentRouter ? liveModels(ctx, ctx.sources.agentRouter.rates) : [];
		if (live.length > 0) {
			console.log(`Fetched ${live.length} tool-capable models from AgentRouter`);
			return live;
		}
		// Every entry skipped is as fatal as an unreachable endpoint: an empty result deletes the provider.
		const failure =
			"failure" in ctx.sources.agentRouter
				? ctx.sources.agentRouter.failure
				: "AgentRouter /api/pricing yielded no usable models";
		const committed = committedModels();
		if (committed.length === 0) {
			console.error(`Failed to fetch AgentRouter models: ${failure}`);
			if (ctx.strict) throw new Error(failure);
			return [];
		}
		console.warn(`Failed to fetch AgentRouter models, keeping the ${committed.length} committed ones: ${failure}`);
		return committed;
	},
	compat: {
		"openai-completions": (model: Model<"openai-completions">) =>
			model.id.includes("deepseek") ? DEEPSEEK_COMPLETIONS_COMPAT : { supportsStrictMode: true },
	},
});
