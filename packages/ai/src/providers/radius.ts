import { knightCodeDecisionApi } from "../api/knightcode-decision.lazy.ts";
import { knightCodeImageApi } from "../api/knightcode-image.lazy.ts";
import { knightCodeMessagesApi } from "../api/knightcode-messages.lazy.ts";
import { envApiKeyAuth, lazyOAuth } from "../auth/helpers.ts";
import { loadRadiusOAuth } from "../auth/oauth/load.ts";
import type { Provider } from "../models.ts";
import type { ClassifierModel, ImageModel, Model } from "../types.ts";
import { isModelType } from "../utils/model-operations.ts";
import { RADIUS_CLASSIFIER_MODELS, RADIUS_IMAGE_MODELS, RADIUS_MODELS } from "./radius.models.ts";
import {
	DEFAULT_RADIUS_GATEWAY,
	getRadiusAllModelsFromConfig,
	getRadiusModels,
	loadRadiusGatewayConfig,
	normalizeRadiusGatewayUrl,
} from "./radius-config.ts";

export interface RadiusProviderOptions {
	id?: string;
	name?: string;
	gateway?: string;
}

type RadiusModel =
	Model<"knightcode-messages"> | ClassifierModel<"knightcode-decision"> | ImageModel<"knightcode-image">;

/** Radius gateway provider with a persisted, dynamically refreshed catalog. */
export function radiusProvider(options: RadiusProviderOptions = {}): Provider<"knightcode-messages"> {
	const id = options.id ?? "radius";
	const name = options.name ?? "Radius";
	const gateway = normalizeRadiusGatewayUrl(options.gateway ?? DEFAULT_RADIUS_GATEWAY);
	const baselineModels: RadiusModel[] =
		gateway === normalizeRadiusGatewayUrl(DEFAULT_RADIUS_GATEWAY)
			? [
					...(Object.values(RADIUS_MODELS) as Model<"knightcode-messages">[]),
					...(Object.values(RADIUS_CLASSIFIER_MODELS) as ClassifierModel<"knightcode-decision">[]),
					...(Object.values(RADIUS_IMAGE_MODELS) as ImageModel<"knightcode-image">[]),
				].map((model) => ({ ...model, provider: id }))
			: [];
	// Gateway catalog for this account. Radius org owners can disable models, so once known it replaces
	// the shipped baseline instead of overlaying it. The baseline only covers the time before any catalog exists.
	let dynamicModels: RadiusModel[] | undefined;
	const streams = knightCodeMessagesApi();
	const classifiers = knightCodeDecisionApi();
	const images = knightCodeImageApi();

	return {
		id,
		name,
		auth: {
			apiKey: envApiKeyAuth("Radius API key", ["RADIUS_API_KEY"]),
			oauth: lazyOAuth({ name, load: () => loadRadiusOAuth({ name, gateway }) }),
		},
		getModels: () =>
			(dynamicModels ?? baselineModels).filter((model): model is Model<"knightcode-messages"> =>
				isModelType(model, "chat"),
			),
		getAllModels: () => dynamicModels ?? baselineModels,
		refreshModels: async (context) => {
			const stored = context.stored;
			if (stored) {
				const restored = stored.models.flatMap((model): RadiusModel[] => {
					if (model.provider !== id) return [];
					if (isModelType(model, "chat") && model.api === "knightcode-messages") {
						return [{ ...model, api: "knightcode-messages", compat: undefined }];
					}
					if (isModelType(model, "classifier")) {
						// Catalogs saved before the route change still contain the old adapter ID.
						if (model.api === "knightcode-classifier" || model.api === "knightcode-decision") {
							return [{ ...model, api: "knightcode-decision", compat: undefined }];
						}
					}
					if (isModelType(model, "image") && model.api === "knightcode-image") {
						return [{ ...model, api: "knightcode-image", compat: undefined }];
					}
					return [];
				});
				if (
					!(await context.publish({
						update: () => {
							dynamicModels = restored;
						},
					}))
				) {
					return;
				}
			}

			// Import catalogs cached by the pre-ModelsStore Radius implementation.
			if (!stored && context.credential?.type === "oauth") {
				const legacy = getRadiusModels(id, context.credential);
				if (legacy.length > 0) {
					if (
						!(await context.publish({
							persist: { models: legacy, checkedAt: Date.now() },
							update: () => {
								dynamicModels = legacy;
							},
						}))
					) {
						return;
					}
				}
			}

			if (!context.allowNetwork || context.signal.aborted) return;
			const apiKey = context.credential?.type === "oauth" ? context.credential.access : context.credential?.key;
			const config = await loadRadiusGatewayConfig(gateway, apiKey, context.signal);
			if (context.signal.aborted) return;
			const refreshed = getRadiusAllModelsFromConfig(id, config);
			await context.publish({
				persist: { models: refreshed, checkedAt: Date.now() },
				update: () => {
					dynamicModels = refreshed;
				},
			});
		},
		stream: (model, context, streamOptions) => streams.stream(model, context, streamOptions),
		streamSimple: (model, context, streamOptions) => streams.streamSimple(model, context, streamOptions),
		classify: (model, context, classifyOptions) => classifiers.classify(model, context, classifyOptions),
		generateImages: (model, context, imageOptions) => images.generateImages(model, context, imageOptions),
	};
}
