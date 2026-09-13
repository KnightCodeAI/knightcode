/**
 * Model catalog route.
 *
 * The only place the IDE learns what models exist and what they can do. The
 * IDE hardcodes no model list, so every field the picker renders is here.
 */

import type { ModelCost } from "@knightcode/ai";
import type { EngineContext } from "./context.ts";
import { type EngineRoute, sendJson } from "./server.ts";

export interface EngineModel {
	/**
	 * Provider-qualified reference to send back as `model` on a completion
	 * request. A bare `id` is not unique across providers, so clients should use
	 * this verbatim rather than assembling one.
	 */
	ref: string;
	id: string;
	providerId: string;
	providerName: string;
	name: string;
	contextWindow: number;
	maxTokens: number;
	reasoning: boolean;
	input: readonly ("text" | "image")[];
	cost: ModelCost;
}

/**
 * A fast model per provider, for Tab, and for commit messages and thread
 * titles when nothing else is set. Each answered a Tab request in about a
 * second with the prompt in completions.ts (2026-09-13); grok-4.6, which
 * reasons on every request, took seven. A provider missing here has no fast
 * model, and the IDE uses the user's own.
 */
export const FAST_MODEL_PER_PROVIDER: Readonly<Record<string, string>> = {
	anthropic: "claude-haiku-4-5",
	openrouter: "qwen/qwen3-coder-flash",
	xai: "grok-4.3",
};

export function modelsRoute(
	ctx: EngineContext,
	fastModels: Readonly<Record<string, string>> = FAST_MODEL_PER_PROVIDER,
): EngineRoute {
	return {
		method: "GET",
		path: "/v1/models",
		handle: async (_req, res) => {
			// getAvailable() applies each provider's auth resolution, so a
			// provider with neither a stored credential nor an ambient one is
			// absent rather than listed and broken.
			const available = await ctx.models.getAvailable();
			const models: EngineModel[] = available.map((model) => ({
				ref: `${model.provider}/${model.id}`,
				id: model.id,
				providerId: model.provider,
				providerName: ctx.models.getProvider(model.provider)?.name ?? model.provider,
				name: model.name,
				contextWindow: model.contextWindow,
				maxTokens: model.maxTokens,
				reasoning: model.reasoning,
				input: model.input,
				cost: model.cost,
			}));
			// Settings are a file the CLI writes too, so the snapshot the engine
			// took at startup goes stale the moment someone picks a different
			// model over there. Re-read instead of naming a model they left.
			await ctx.settings.reload();
			// The model the user picked, as a ref, and only when it is one of
			// the models above. A client that has to choose a default on its
			// own ends up choosing by catalog order, which is alphabetical by
			// provider and says nothing about what anyone wanted.
			const provider = ctx.settings.getDefaultProvider();
			const id = ctx.settings.getDefaultModel();
			const chosen = provider && id ? `${provider}/${id}` : undefined;
			const defaultRef = models.some((model) => model.ref === chosen) ? chosen : null;
			// Only ever from the provider already chosen, so no other account is spent.
			const fastId = provider ? fastModels[provider] : undefined;
			const fastRef = fastId ? `${provider}/${fastId}` : undefined;
			const fast = models.some((model) => model.ref === fastRef) ? fastRef : null;
			sendJson(res, 200, { models, default: defaultRef ?? null, fast: fast ?? null });
		},
	};
}
