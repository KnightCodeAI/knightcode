import type { ProviderImages } from "../types.ts";

export const knightCodeImageApi = (): ProviderImages => ({
	generateImages: async (model, context, options) =>
		(await import("./knightcode-image.ts")).generateImages(model, context, options),
});
