import type {
  ModeType,
  ReasoningEffortLevel,
  SupportedChatModelId,
  ToolContracts,
} from "@repo/shared";
import type { InferUITools, LanguageModelUsage, UIMessage } from "ai";

export type ChatMessageMetadata = {
  mode?: ModeType;
  model?: SupportedChatModelId | string;
  reasoningEffort?: ReasoningEffortLevel;
  /** Wall-clock ms when the user submitted this prompt; anchors turn timing. */
  submittedAt?: number;
  durationMs?: number;
  usage?: LanguageModelUsage;
  /** Actual USD cost of this turn's model calls. When OpenRouter reports a cost,
   *  we use it (authoritative); otherwise defaults to 0 to avoid incorrect
   *  fallback pricing for free/cached requests. */
  costUsd?: number;
  isCompaction?: boolean;
  isInterrupted?: boolean;
  originalMessageCount?: number;
  summaryCount?: number;
  preservedCount?: number;
  commandProgressMessage?: string;
  /** Skills surfaced by auto-discovery / path-matching during this turn —
   *  rendered as a visible "relevant skills" line above the assistant reply. */
  surfacedSkills?: string[];
};

type ChatTools = {
  [Name in keyof InferUITools<ToolContracts>]: {
    input: InferUITools<ToolContracts>[Name]["input"];
    output: unknown;
  };
};

export type Message = UIMessage<ChatMessageMetadata, never, ChatTools>;

export type PendingConfirmation = {
  toolCallId: string;
  toolCall: {
    toolCallId: string;
    toolName: string;
    input: any;
  };
  mode: ModeType;
  modelOverride?: SupportedChatModelId;
  /** "subagent" = bubbled from a foreground subagent's inner tool call —
   *  its toolCallId matches no transcript part, so the prompt must render
   *  standalone instead of inline under the tool row. */
  source?: "subagent";
};
