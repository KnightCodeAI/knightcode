import type { ProviderClassifier } from "../types.ts";

export const knightCodeClassifierApi = (): ProviderClassifier => ({
	classify: async (model, context, options) =>
		(await import("./knightcode-classifier.ts")).classify(model, context, options),
});
