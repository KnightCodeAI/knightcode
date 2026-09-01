import { anthropicMessagesApi } from "../api/anthropic-messages.lazy.ts";
import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { AGENTROUTER_MODELS } from "./agentrouter.models.ts";

export function agentrouterProvider(): Provider<"anthropic-messages" | "openai-completions"> {
	return createProvider({
		id: "agentrouter",
		name: "AgentRouter",
		baseUrl: "https://agentrouter.org/v1",
		auth: { apiKey: envApiKeyAuth("AgentRouter API key", ["AGENTROUTER_API_KEY"]) },
		models: Object.values(AGENTROUTER_MODELS),
		api: {
			"anthropic-messages": anthropicMessagesApi(),
			"openai-completions": openAICompletionsApi(),
		},
	});
}
