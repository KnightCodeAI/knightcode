import type { ProviderClassifier } from "../types.ts";

export const knightCodeDecisionApi = (): ProviderClassifier => ({
	classify: async (model, context, options) =>
		(await import("./knightcode-decision.ts")).classify(model, context, options),
});
