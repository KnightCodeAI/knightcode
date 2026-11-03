// Development and browser tests only: an OpenAI-compatible server (test/fake-model-server.ts) offered as the provider
// "fake", so the real Worker runs without billing a provider. Its model ids come from configuration
// (BOTS_DEV_MODEL_IDS, comma-separated), never from code. Absent unless BOTS_DEV_MODEL_URL is set, which no deployed
// configuration does.
import { openAICompletionsApi } from "@knightcode/ai/api/openai-completions.lazy";
import { createProvider, type MutableModels, type Provider } from "@knightcode/ai/models";
import type { Env } from "../env.ts";

export function devModelProvider(env: Env): Provider<"openai-completions"> | undefined {
	const baseUrl = env.BOTS_DEV_MODEL_URL;
	const ids = (env.BOTS_DEV_MODEL_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
	if (!baseUrl || ids.length === 0) return undefined;
	return createProvider({
		id: "fake",
		name: "Fake model server",
		baseUrl,
		// Keyless: the server answers anyone, so the provider is always configured.
		auth: { apiKey: { name: "Fake model server", resolve: async () => ({ auth: { apiKey: "dev" }, source: "development server" }) } },
		models: ids.map((id) => ({
			id,
			name: id,
			api: "openai-completions" as const,
			provider: "fake",
			baseUrl,
			input: ["text" as const],
			reasoning: false,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128_000,
			maxTokens: 4_096,
		})),
		api: openAICompletionsApi(),
	});
}

/** Adds the development provider to `models` when it is configured. */
export function withDevModels<M extends MutableModels>(env: Env, models: M): M {
	const provider = devModelProvider(env);
	if (provider) models.setProvider(provider);
	return models;
}
