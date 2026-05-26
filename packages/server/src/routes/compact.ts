import { zValidator } from "@hono/zod-validator";
import { db } from "@knightcode/database/client";
import { getToolContracts, modeSchema } from "@knightcode/shared";
import { isSupportedChatModel, resolveChatModel } from "../lib/models";
import { convertToModelMessages, generateText, validateUIMessages } from "ai";
import { Hono } from "hono";
import { z } from "zod";
import { calculateCreditsForUsage } from "../lib/credits";
import { ingestAiUsage } from "../lib/polar";
import type { AuthenticatedEnv } from "../middleware/require-auth";
import { requireCreditsBalance } from "../middleware/require-credits-balance";

const compactSchema = z.object({
  id: z.string(),
  messages: z.array(z.any()).min(1),
  mode: modeSchema,
  model: z.string().refine(isSupportedChatModel, "Unsupported model"),
});

const compactValidator = zValidator("json", compactSchema, (result, c) => {
  if (!result.success) {
    return c.json({ error: "Invalid request body" }, 400);
  }
});

function estimateTokensForText(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

function estimateTokensForMessages(messages: any[]): number {
  let tokens = 0;
  for (const msg of messages) {
    if (!msg) continue;
    if (typeof msg.content === "string") {
      tokens += estimateTokensForText(msg.content);
    }
    if (Array.isArray(msg.parts)) {
      for (const part of msg.parts) {
        if (!part) continue;
        if (part.type === "text" && typeof part.text === "string") {
          tokens += estimateTokensForText(part.text);
        } else if (part.type === "reasoning" && typeof part.text === "string") {
          tokens += estimateTokensForText(part.text);
        } else if (
          typeof part.type === "string" &&
          (part.type === "dynamic-tool" || part.type.startsWith("tool-"))
        ) {
          if (part.input) {
            tokens += estimateTokensForText(JSON.stringify(part.input));
          }
          if (part.output) {
            tokens += estimateTokensForText(JSON.stringify(part.output));
          }
        }
      }
    }
  }
  return tokens;
}

const app = new Hono<AuthenticatedEnv>().post(
  "/",
  requireCreditsBalance,
  compactValidator,
  async (c) => {
    const userId = c.get("userId");
    const { id, messages, mode, model } = c.req.valid("json");

    const session = await db.session.findUnique({
      where: { id, userId },
    });

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    // If there are too few messages to compact, return as is.
    if (messages.length <= 4) {
      return c.json({
        compactedMessages: messages,
        credits: 0,
        estimatedTokens: 1500 + estimateTokensForMessages(messages),
      });
    }

    const resolvedModel = resolveChatModel(model);
    const tools = getToolContracts(mode);
    const validatedMessages = await validateUIMessages({
      messages: messages as any[],
      tools: tools as any,
    });

    // Keep the last 4 messages intact, summarize everything before.
    const toSummarize = validatedMessages.slice(0, -4);
    const preserved = validatedMessages.slice(-4);

    const modelMessages = await convertToModelMessages(toSummarize, {
      tools: tools as any,
    });

    const compPrompt = `You are an expert technical coordinator. Your task is to analyze the conversation history between a developer and a coding assistant and compile a comprehensive, highly-structured, and dense engineering state summary. This summary will be used to compact the chat history so that the assistant retains complete, high-fidelity context of all work completed, files read/modified, active goals, design decisions, and unresolved issues, without needing to re-read the raw messages.

Format the summary as a markdown block with the following sections:

# ENGINEERING STATE SUMMARY

## 1. Primary Objectives & Active Goals
- Detailed breakdown of what the user is currently trying to achieve.
- The overarching goal of the session and the specific tasks in focus.

## 2. Current Implementation Status
- Step-by-step summary of what has been accomplished so far.
- What is currently in progress.
- What is planned next.

## 3. Files Read & Modified
- For each file accessed or edited:
  - 'path/to/file': Action (READ / CREATE / MODIFY) - Brief description of what was read or what exact changes were made. Be specific.

## 4. Key Architectural & Design Decisions
- Constraints specified by the user or identified from the environment.
- Architectural patterns, choices of models/libraries, or styling preferences agreed upon.
- Important rationale behind why things were built a certain way.

## 5. Technical Context & State
- State of any compilers, servers, or environment variables (e.g., ports, runtime errors found, mock setups, api credentials).
- Known errors that were hit and how they were resolved (or if they are still blocking).

## 6. Open Issues & Tech Debt
- Known bugs, regressions, or unhandled edge cases.
- Performance concerns, missing validation, or areas of code that need cleanup/polishing.
- Stated next steps that have not yet been executed.

---
Produce only this summary. Be extremely precise, technical, and complete. Do not omit any crucial context, file paths, or developer instructions. Do not add conversational intro/outro.`;

    const compMessages = [
      ...modelMessages,
      {
        role: "user",
        content:
          "Generate the engineering state summary of the conversation so far. Format it exactly as instructed.",
      },
    ];

    try {
      const compResult = await generateText({
        model: resolvedModel.model,
        system: compPrompt,
        messages: compMessages as any[],
        providerOptions: resolvedModel.providerOptions,
      });

      const usage = compResult.usage;
      const billableUsage = calculateCreditsForUsage({
        provider: resolvedModel.provider,
        model: resolvedModel.modelId,
        usage,
      });

      const compactionId = `compaction-${Date.now()}`;
      await ingestAiUsage({
        externalCustomerId: userId,
        eventId: `compaction:${id}:${compactionId}`,
        credits: billableUsage.credits,
      });

      const summaryMessage = {
        id: compactionId,
        role: "assistant" as const,
        parts: [{ type: "text" as const, text: compResult.text }],
        metadata: {
          isCompaction: true,
          model: resolvedModel.modelId,
          credits: billableUsage.credits,
          originalMessageCount: messages.length,
          summaryCount: 1,
          preservedCount: preserved.length,
        },
      };

      const compactedMessages = [summaryMessage, ...preserved];

      // Calculate estimated new context size
      const estimatedTokens =
        1500 + estimateTokensForMessages(compactedMessages);

      // Find the last assistant message in compactedMessages to update its token count metadata.
      // This will automatically refresh the TUI status bar.
      const isRecord = (v: unknown): v is Record<string, any> =>
        !!v && typeof v === "object";
      const lastAssistantMessage = [...compactedMessages]
        .reverse()
        .find((m) => isRecord(m) && m.role === "assistant");
      if (lastAssistantMessage) {
        // Zero out metadata.usage on all other messages in compactedMessages to avoid double counting
        for (const msg of compactedMessages) {
          if (isRecord(msg) && msg !== lastAssistantMessage && msg.metadata) {
            delete (msg.metadata as Record<string, unknown>).usage;
          }
        }

        const writableLastAssistantMessage = lastAssistantMessage as Record<
          string,
          any
        >;
        if (!writableLastAssistantMessage.metadata) {
          writableLastAssistantMessage.metadata = {};
        }
        writableLastAssistantMessage.metadata.usage = {
          inputTokens: estimatedTokens,
          outputTokens:
            writableLastAssistantMessage.metadata.usage?.outputTokens ?? 0,
        };
      }

      await db.session.update({
        where: { id, userId },
        data: {
          messages: compactedMessages as any,
        },
      });

      return c.json({
        compactedMessages,
        credits: billableUsage.credits,
        estimatedTokens,
      });
    } catch (err: any) {
      console.error("Compaction failed:", err);
      return c.json(
        { error: `Compaction failed: ${err.message || String(err)}` },
        500,
      );
    }
  },
);

export default app;
