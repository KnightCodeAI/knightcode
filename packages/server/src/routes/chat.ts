import { zValidator } from "@hono/zod-validator";
import {
  getDeferredToolNames,
  getToolContracts,
  modeSchema,
  TASK_SUITE_TOOL_NAMES,
  type ModeType,
  type ToolContracts,
  type ReasoningEffortLevel,
} from "@knightcode/shared";
import {
  convertToModelMessages,
  streamText,
  validateUIMessages,
  type InferUITools,
  type LanguageModelUsage,
  type UIMessage,
} from "ai";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "@knightcode/database/client";
import { calculateCreditsForUsage } from "../lib/credits";
import { isSupportedChatModel, resolveChatModel } from "../lib/models";
import { ingestAiUsage } from "../lib/polar";
import type { AuthenticatedEnv } from "../middleware/require-auth";
import { requireCreditsBalance } from "../middleware/require-credits-balance";
import { buildSystemPrompt } from "../system-prompt";
import {
  loadSessionMessages,
  saveMessage,
  finalizeAssistantMessage,
} from "../lib/messages";
import { extractLoadedDeferredTools } from "../lib/loaded-deferred-tools";

type ChatMessageMetadata = {
  mode?: ModeType;
  model?: string;
  durationMs?: number;
  usage?: LanguageModelUsage;
  isInterrupted?: boolean;
};

type KnightcodeUIMessage = UIMessage<
  ChatMessageMetadata,
  never,
  InferUITools<ToolContracts>
>;

const submitSchema = z.object({
  id: z.string(),
  messages: z
    .array(
      z.custom<KnightcodeUIMessage>((value) => {
        return (
          value != null &&
          typeof value === "object" &&
          "id" in value &&
          "parts" in value
        );
      }),
    )
    .min(1),
  mode: modeSchema,
  model: z.string().refine(isSupportedChatModel, "Unsupported model"),
  globalInstructions: z.string().max(8000).optional(),
  projectInstructions: z.string().max(8000).optional(),
  localInstructions: z.string().max(8000).optional(),
  rules: z.string().max(20000).optional(),
  skillIndex: z.string().max(4000).optional(),
  gitBranchName: z.string().max(256).optional(),
  gitStatus: z.string().max(12000).optional(),
  gitDiffSummary: z.string().max(12000).optional(),
  frameworks: z.array(z.string().max(64)).max(20).optional(),
  packageManager: z.string().max(64).optional(),
  isTypeScript: z.boolean().optional(),
  shellName: z.string().max(32).optional(),
  platform: z.string().max(32).optional(),
  hasPersistedTasks: z.boolean().optional(),
  agentTypes: z.string().max(8000).optional(),
});

const submitValidator = zValidator("json", submitSchema, (result, c) => {
  if (!result.success) {
    return c.json({ error: "Invalid request body" }, 400);
  }
});

function hasPendingToolCalls(message: {
  parts: Array<{ type?: string; state?: string }>;
}) {
  return message.parts.some((part) => {
    if (part.type === "dynamic-tool" || part.type?.startsWith("tool-")) {
      const state = part.state;
      return state !== "output-available" && state !== "output-error";
    }
    return false;
  });
}

function toUIMessage(stored: {
  id: string;
  role: string;
  parts: any[];
  metadata: Record<string, unknown> | undefined;
}): KnightcodeUIMessage {
  return {
    id: stored.id,
    role: stored.role as KnightcodeUIMessage["role"],
    parts: stored.parts as KnightcodeUIMessage["parts"],
    metadata: stored.metadata as KnightcodeUIMessage["metadata"],
  } as KnightcodeUIMessage;
}

const app = new Hono<AuthenticatedEnv>().post(
  "/",
  requireCreditsBalance,
  submitValidator,
  async (c) => {
    const userId = c.get("userId");
    const {
      id,
      messages,
      mode,
      model,
      globalInstructions,
      projectInstructions,
      localInstructions,
      rules,
      skillIndex,
      gitBranchName,
      gitStatus,
      gitDiffSummary,
      frameworks,
      packageManager,
      isTypeScript,
      shellName,
      platform,
      hasPersistedTasks,
      agentTypes,
    } = c.req.valid("json");

    const session = await db.session.findUnique({
      where: { id, userId },
    });

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const startTime = Date.now();
    const resolvedModel = resolveChatModel(
      model,
      session.reasoningEffort as ReasoningEffortLevel,
    );

    // Load history from relational Message rows, dropping rows that ended in
    // an unrecoverable state (incomplete tool parts) and stripping
    // StoredMessage's extra root-level fields that validateUIMessages rejects.
    const previousMessages = (await loadSessionMessages(id))
      .filter((m) => m.status !== "error")
      .map(toUIMessage);
    const mergedMessages = [...previousMessages];

    for (const message of messages) {
      const incomingMessage = {
        ...message,
        metadata: { ...message.metadata, mode, model },
      } satisfies KnightcodeUIMessage;

      const existingIndex = mergedMessages.findIndex(
        (m) => m.id === incomingMessage.id,
      );
      if (existingIndex === -1) {
        mergedMessages.push(incomingMessage);
      } else {
        mergedMessages[existingIndex] = incomingMessage;
      }
    }

    // Persist incoming user messages immediately — they're saved before streaming begins
    // so an abort never loses the user's turn
    for (const message of messages) {
      if (message.role === "user") {
        await saveMessage(id, {
          id: message.id,
          role: message.role,
          parts: message.parts as any[],
          metadata: { ...message.metadata, mode, model } as Record<
            string,
            unknown
          >,
          status: "complete",
        });
      }
    }

    // Derive which deferred tools the model has loaded earlier in this
    // conversation by scanning ToolSearch outputs. Build the per-turn tool
    // set as base + loaded deferred; announce the still-unloaded set via the
    // system prompt's <system-reminder> block.
    const loadedDeferred = extractLoadedDeferredTools(mergedMessages);
    // Adaptive pre-load: when the workspace already has incomplete tasks, the
    // Task suite is clearly in use — surface it from turn 1 so the model can
    // resume cross-session work without a ToolSearch detour.
    if (hasPersistedTasks) {
      for (const name of TASK_SUITE_TOOL_NAMES) loadedDeferred.add(name);
    }
    const tools = getToolContracts(mode, { loaded_deferred: loadedDeferred });
    const availableDeferredTools = getDeferredToolNames(mode).filter(
      (name) => !loadedDeferred.has(name),
    );

    const nextMessages = await validateUIMessages<KnightcodeUIMessage>({
      messages: mergedMessages,
      tools,
    });
    const modelMessages = await convertToModelMessages(nextMessages, { tools });

    // Accumulate usage across all steps (each tool-call round is one step)
    let accumulatedUsage: LanguageModelUsage | null = null;

    const result = streamText({
      model: resolvedModel.model,
      system: buildSystemPrompt({
        mode,
        globalInstructions,
        projectInstructions,
        localInstructions,
        rules,
        skillIndex,
        gitBranchName,
        gitStatus,
        gitDiffSummary,
        frameworks,
        packageManager,
        isTypeScript,
        shellName,
        platform,
        availableDeferredTools,
        agentTypes,
      }),
      messages: modelMessages,
      tools,
      providerOptions: resolvedModel.providerOptions,
      abortSignal: c.req.raw.signal,
      onStepFinish(event) {
        const u = event.usage;
        if (u) {
          if (!accumulatedUsage) {
            accumulatedUsage = u;
          } else {
            accumulatedUsage = {
              ...accumulatedUsage,
              inputTokens:
                (accumulatedUsage.inputTokens ?? 0) + (u.inputTokens ?? 0),
              outputTokens:
                (accumulatedUsage.outputTokens ?? 0) + (u.outputTokens ?? 0),
              totalTokens:
                (accumulatedUsage.totalTokens ?? 0) + (u.totalTokens ?? 0),
            };
          }
        }
      },
    });

    return result.toUIMessageStreamResponse<KnightcodeUIMessage>({
      originalMessages: nextMessages,
      messageMetadata({ part }) {
        if (part.type === "start") {
          return { mode, model };
        }
        if (part.type !== "finish") return undefined;
        return {
          mode,
          model,
          durationMs: Date.now() - startTime,
          ...(accumulatedUsage ? { usage: accumulatedUsage } : {}),
        };
      },
      async onFinish(event) {
        const isAborted = event.isAborted;
        const responseMessage = event.responseMessage;
        const durationMs = Date.now() - startTime;

        // Prefer AI SDK's canonical totalUsage; fall back to the running
        // accumulator (kept for the streaming `finish` part's metadata).
        const finalUsage =
          (event as unknown as { totalUsage?: LanguageModelUsage })
            .totalUsage ?? accumulatedUsage;

        let credits = 0;
        if (finalUsage) {
          try {
            const billableUsage = calculateCreditsForUsage({
              provider: resolvedModel.provider,
              model: resolvedModel.modelId,
              usage: finalUsage,
            });
            credits = billableUsage.credits;
          } catch (err) {
            console.error("Failed to calculate credits:", err);
          }
        }

        // A stream that ended with a tool part still in input-streaming /
        // input-available state is an incomplete turn — convertToModelMessages
        // will reject it on the next load. Persist as "error" so the load path
        // can filter it instead of bricking the session.
        const pending = hasPendingToolCalls({
          parts: responseMessage.parts as any[],
        });
        const finalStatus = isAborted
          ? "interrupted"
          : pending
            ? "error"
            : "complete";

        const metadata: ChatMessageMetadata = {
          mode,
          model,
          durationMs,
          ...(finalUsage ? { usage: finalUsage } : {}),
          ...(isAborted ? { isInterrupted: true } : {}),
        };

        await finalizeAssistantMessage(responseMessage.id, id, {
          status: finalStatus,
          parts: responseMessage.parts as any[],
          metadata: metadata as Record<string, unknown>,
          durationMs,
          usage: finalUsage,
          credits,
        });

        // Only bill when the turn produced a usable assistant message.
        // Idempotency: the bare message id is stable across retries; randomising
        // it would defeat Polar's dedup and cause double-billing.
        if (credits > 0 && finalStatus !== "error") {
          try {
            await ingestAiUsage({
              externalCustomerId: userId,
              eventId: `chat-message:${responseMessage.id}`,
              credits,
            });
          } catch (error) {
            console.error("Failed to ingest Polar AI usage for chat message", {
              error,
              sessionId: id,
              messageId: responseMessage.id,
              userId,
            });
          }
        }
      },
      onError(error) {
        return error instanceof Error ? error.message : String(error);
      },
    });
  },
);

export default app;
