// Authored selectors exposed by the unofficial Gemini web app; no public API catalog exists for them.
import type { Model } from "../../src/types.ts";
import { defineProvider } from "../define.ts";

const BASE_URL = "https://gemini.google.com";

function thinkingModel(id: string, name: string, maxTokens: number): Model<"gemini-web"> {
	return {
		id,
		name,
		api: "gemini-web",
		provider: "gemini-web",
		baseUrl: BASE_URL,
		reasoning: true,
		thinkingLevelMap: {
			off: null,
			minimal: null,
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: null,
			max: null,
		},
		input: ["text"],
		// Web allowance accounting is unavailable, not free. Limits are local estimates, not Google guarantees.
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_048_576,
		maxTokens,
	};
}

export default defineProvider({
	id: "gemini-web",
	models: () => [
		{
			id: "default",
			name: "Gemini (Account Default)",
			api: "gemini-web",
			provider: "gemini-web",
			baseUrl: BASE_URL,
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128_000,
			maxTokens: 8_192,
		},
		thinkingModel("gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite", 65_536),
		thinkingModel("gemini-3.8-flash", "Gemini 3.8 Flash", 65_536),
		thinkingModel("gemini-3.1-pro", "Gemini 3.1 Pro", 65_536),
		thinkingModel("gemini-4-argon", "Gemini 4 Argon", 32_768),
	],
});
