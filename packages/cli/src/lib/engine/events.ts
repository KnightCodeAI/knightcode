import type { ModeType, ReasoningEffortLevel } from "@repo/shared";
import type { Message } from "./messages";

export type ToolCallRequest = {
  toolCallId: string;
  toolName: string;
  input: unknown;
};

export type ToolOutcome =
  | { kind: "output"; output: unknown }
  | { kind: "error"; errorText: string };

export type EngineEvent =
  | { type: "stream_start" }
  /** In-progress assistant message snapshot; replaces the previous snapshot. */
  | { type: "message_update"; message: Message }
  | { type: "tool_call"; toolCall: ToolCallRequest }
  | { type: "tool_result"; toolCallId: string; outcome: ToolOutcome }
  /** Final assistant message for the turn, metadata (durationMs/usage) attached. */
  | { type: "turn_complete"; message: Message };

export type TerminalReason = "complete" | "aborted" | "max_rounds" | "error";
export type Terminal = { reason: TerminalReason; error?: unknown };

// Session identity intentionally absent: persistence and tool execution
// receive it via the runTool closure, keeping the engine session-agnostic.
export type QueryParams = {
  cwd: string;
  /** Full transcript including the just-submitted user message. */
  messages: Message[];
  mode: ModeType;
  modelId: string;
  reasoningEffort: ReasoningEffortLevel;
  getApiKey?: () => string | undefined;
  /** Executes one tool call (permission gating happens inside). Must not throw
   *  for ordinary failures — return { kind: "error" }. Throws are still caught. */
  runTool: (toolCall: ToolCallRequest) => Promise<ToolOutcome>;
  abortSignal?: AbortSignal;
  /** Anchor for durationMs (the user's submit time). Defaults to Date.now(). */
  turnStartMs?: number;
  /** Ms spent waiting on the user this turn — subtracted from durationMs. */
  getTurnPausedMs?: () => number;
  maxRounds?: number; // default 100
};
