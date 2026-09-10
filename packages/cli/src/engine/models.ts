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

export function modelsRoute(ctx: EngineContext): EngineRoute {
	return {
		method: "GET",
		path: "/v1/models",
		handle: async (_req, res) => {
			// getAvailable() applies each provider's auth resolution, so a
			// provider with neither a stored credential nor an ambient one is
			// absent rather than listed and broken.
			const available = await ctx.models.getAvailable();
			const models: EngineModel[] = available.map((model) => ({
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
			sendJson(res, 200, { models });
		},
	};
}
