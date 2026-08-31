import { describe, expect, it } from "vitest";
import { buildBaseOptions } from "../src/api/simple-options.ts";
import type { AssistantMessage, Context, Model, Usage } from "../src/types.ts";
import { estimateContextTokens } from "../src/utils/estimate.ts";

function createUsage(totalTokens: number): Usage {
	return {
		input: totalTokens,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function createAssistant(timestamp: number, totalTokens: number): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "kept" }],
		api: "openai-responses",
		provider: "openai",
		model: "test-model",
		usage: createUsage(totalTokens),
		stopReason: "stop",
		timestamp,
	};
}

const model: Model<"openai-responses"> = {
	id: "test-model",
	name: "Test Model",
	api: "openai-responses",
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 10_000,
	maxTokens: 8_000,
};

describe("context token estimation", () => {
	it("ignores stale assistant usage after a newer message is inserted before it", () => {
		const context: Context = {
			systemPrompt: "system",
			messages: [
				{ role: "user", content: "summary", timestamp: 200 },
				createAssistant(100, 9_500),
				{ role: "user", content: "x".repeat(4_000), timestamp: 300 },
			],
		};

		expect(estimateContextTokens(context)).toEqual({
			tokens: 1_005,
			usageTokens: 0,
			trailingTokens: 1_005,
			lastUsageIndex: null,
		});
		// 10_000 - ceil(1_005 * 1.5) - 4_096
		expect(buildBaseOptions(model, context).maxTokens).toBe(4_396);
	});

	it("uses assistant usage again after a response to the inserted context", () => {
		const context: Context = {
			messages: [
				{ role: "user", content: "summary", timestamp: 200 },
				createAssistant(100, 9_500),
				{ role: "user", content: "new prompt", timestamp: 300 },
				createAssistant(400, 2_000),
				{ role: "user", content: "tail", timestamp: 500 },
			],
		};

		expect(estimateContextTokens(context)).toEqual({
			tokens: 2_001,
			usageTokens: 2_000,
			trailingTokens: 1,
			lastUsageIndex: 3,
		});
	});

	it("keeps max_tokens inside the window when chars/4 under-counts the context", () => {
		// Field failure (openrouter/moonshotai/kimi-k2.6): the estimator said 59,256 tokens for a
		// context the provider counted at 65,872, so max_tokens = 262,144 - 59,256 - 4,096 = 198,792
		// and the request overflowed the window by 2,520 tokens.
		const bigModel: Model<"openai-responses"> = { ...model, contextWindow: 262_144, maxTokens: 235_929 };
		const context: Context = {
			messages: [{ role: "user", content: "x".repeat(59_256 * 4), timestamp: 1 }],
		};
		const actualPromptTokens = Math.ceil(estimateContextTokens(context).tokens * 1.12);
		const maxTokens = buildBaseOptions(bigModel, context).maxTokens!;

		expect(actualPromptTokens + maxTokens).toBeLessThanOrEqual(bigModel.contextWindow);
	});

	it("does not pad tokens the provider already reported", () => {
		const context: Context = {
			messages: [{ role: "user", content: "hi", timestamp: 100 }, createAssistant(200, 5_000)],
		};

		// 10_000 - 5_000 (exact usage) - ceil(0 * 1.5) - 4_096
		expect(buildBaseOptions(model, context).maxTokens).toBe(904);
	});
});
