import {
  getToolContracts,
  type ModeType,
  type ReasoningEffortLevel,
} from "@repo/shared";
import {
  convertToModelMessages,
  generateText,
  validateUIMessages,
  type ModelMessage,
} from "ai";
import { resolveModel } from "./resolve-model";

export const COMPACTION_PROMPT = `You are an expert technical coordinator. Your task is to analyze the conversation history between a developer and a coding assistant and compile a comprehensive, highly-structured, and dense engineering state summary. This summary will be used to compact the chat history so that the assistant retains complete, high-fidelity context of all work completed, files read/modified, active goals, design decisions, and unresolved issues, without needing to re-read the raw messages.

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

function estimateTokensForText(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

export function estimateTokensForMessages(messages: any[]): number {
  let tokens = 0;
  for (const msg of messages) {
    if (!msg) continue;
    if (typeof msg.content === "string")
      tokens += estimateTokensForText(msg.content);
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
          if (part.input)
            tokens += estimateTokensForText(JSON.stringify(part.input));
          if (part.output)
            tokens += estimateTokensForText(JSON.stringify(part.output));
        }
      }
    }
  }
  return tokens;
}

export type CompactConversationInput = {
  messages: any[];
  model: string;
  mode: ModeType;
  reasoningEffort?: ReasoningEffortLevel;
  /** Injected for testability; defaults to a generateText call via resolveModel. */
  summarize?: (modelMessages: ModelMessage[]) => Promise<string>;
};

export type CompactConversationResult = {
  compactedMessages: any[];
  estimatedTokens: number;
};

/**
 * Summarize everything before the last 4 messages into a single compaction
 * message, preserving the tail. Pure inference + assembly; the caller persists.
 */
export async function compactConversation(
  input: CompactConversationInput,
): Promise<CompactConversationResult> {
  const { messages, model, mode } = input;

  if (messages.length <= 4) {
    return {
      compactedMessages: messages,
      estimatedTokens: 1500 + estimateTokensForMessages(messages),
    };
  }

  const tools = getToolContracts(mode);
  const validated = await validateUIMessages({
    messages: (messages as any[]).filter(
      (m) => !(m.role === "assistant" && Array.isArray(m.parts) && m.parts.length === 0),
    ),
    tools: tools as any,
  });

  const toSummarize = validated.slice(0, -4);
  const preserved = validated.slice(-4);
  const lastSummarized = toSummarize[toSummarize.length - 1];
  const compactionId = `compaction-${lastSummarized?.id ?? "initial"}`;

  const modelMessages = await convertToModelMessages(toSummarize, {
    tools: tools as any,
  });
  const compMessages: ModelMessage[] = [
    ...modelMessages,
    {
      role: "user",
      content:
        "Generate the engineering state summary of the conversation so far. Format it exactly as instructed.",
    },
  ];

  const summarize =
    input.summarize ??
    (async (mm: ModelMessage[]) => {
      const resolved = resolveModel(model, input.reasoningEffort ?? "medium");
      const result = await generateText({
        model: resolved.model,
        system: COMPACTION_PROMPT,
        messages: mm,
        providerOptions: resolved.providerOptions,
      });
      return result.text;
    });

  const summaryText = await summarize(compMessages);

  const summaryMessage = {
    id: compactionId,
    role: "assistant" as const,
    parts: [{ type: "text" as const, text: summaryText }],
    metadata: {
      isCompaction: true,
      model,
      originalMessageCount: messages.length,
      summaryCount: 1,
      preservedCount: preserved.length,
    } as Record<string, unknown>,
  };

  const compactedMessages = [summaryMessage, ...preserved];
  const estimatedTokens = 1500 + estimateTokensForMessages(compactedMessages);

  // Keep the status bar honest: put the estimated context size on the last
  // assistant message's usage, and zero out the others' usage.
  const lastAssistant = [...compactedMessages]
    .reverse()
    .find((m: any) => m && m.role === "assistant") as any;
  if (lastAssistant) {
    for (const m of compactedMessages as any[]) {
      if (m && m !== lastAssistant && m.metadata) delete m.metadata.usage;
    }
    lastAssistant.metadata = lastAssistant.metadata ?? {};
    lastAssistant.metadata.usage = {
      inputTokens: estimatedTokens,
      outputTokens: lastAssistant.metadata.usage?.outputTokens ?? 0,
    };
  }

  return { compactedMessages, estimatedTokens };
}
