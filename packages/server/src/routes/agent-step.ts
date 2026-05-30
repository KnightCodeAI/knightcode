import { zValidator } from "@hono/zod-validator";
import {
  getToolContractsByNames,
  modeSchema,
  type ReasoningEffortLevel,
} from "@knightcode/shared";
import { generateText, type ModelMessage } from "ai";
import { Hono } from "hono";
import { z } from "zod";
import { calculateCreditsForUsage } from "../lib/credits";
import { isSupportedChatModel, resolveChatModel } from "../lib/models";
import { ingestAiUsage } from "../lib/polar";
import type { AuthenticatedEnv } from "../middleware/require-auth";
import { requireCreditsBalance } from "../middleware/require-credits-balance";

const bodySchema = z.object({
  system: z.string(),
  // Subagent messages are AI SDK ModelMessages built on the client.
  messages: z
    .array(
      z.custom<ModelMessage>(
        (v) => v != null && typeof v === "object" && "role" in v,
      ),
    )
    .min(1),
  toolNames: z.array(z.string().max(64)).max(64),
  mode: modeSchema,
  model: z.string().refine(isSupportedChatModel, "Unsupported model"),
});

const app = new Hono<AuthenticatedEnv>().post(
  "/",
  requireCreditsBalance,
  zValidator("json", bodySchema, (result, c) => {
    if (!result.success) return c.json({ error: "Invalid request body" }, 400);
  }),
  async (c) => {
    const userId = c.get("userId");
    const { system, messages, toolNames, model } = c.req.valid("json");
    const resolvedModel = resolveChatModel(
      model,
      "medium" as ReasoningEffortLevel,
    );
    const tools = getToolContractsByNames(toolNames);

    const result = await generateText({
      model: resolvedModel.model,
      system,
      messages,
      tools,
      providerOptions: resolvedModel.providerOptions,
      abortSignal: c.req.raw.signal,
    });

    // Bill the turn (idempotent on the generated assistant message id).
    let credits = 0;
    if (result.usage) {
      try {
        credits = calculateCreditsForUsage({
          provider: resolvedModel.provider,
          model: resolvedModel.modelId,
          usage: result.usage,
        }).credits;
        if (credits > 0) {
          await ingestAiUsage({
            externalCustomerId: userId,
            eventId: `agent-step:${result.response.id}`,
            credits,
          });
        }
      } catch (err) {
        console.error("agent-step billing failed", err);
      }
    }

    return c.json({
      text: result.text,
      toolCalls: result.toolCalls.map((tc) => ({
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        input: tc.input,
      })),
      finishReason: result.finishReason,
      usage: result.usage ?? null,
      credits,
    });
  },
);

export default app;
