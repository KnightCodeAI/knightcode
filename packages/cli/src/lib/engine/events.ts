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

/** UI's answer to a gated tool call. */
export type PermissionDecision =
  | {
      behavior: "allow";
      /** Persist the grant (bash allowlist / session-wide edit approval). */
      always?: boolean;
      /** Raw OpenRouter id override for Agent spawns (per-spawn model pick). */
      modelOverride?: string;
    }
  | { behavior: "deny"; feedback?: string };

/**
 * Everything the engine needs from its embedder to run tools. Supplied by
 * useQueryEngine (and later, recursively, by the Agent tool). The engine owns
 * gating, loop protection, hooks, and scheduling; the host owns execution and
 * user interaction.
 */
export type ToolHost = {
  /** Execute one already-approved tool call. Throws on failure. */
  executeTool: (
    toolCall: ToolCallRequest,
    mode: ModeType,
    opts: { modelOverride?: string },
  ) => Promise<unknown>;
  /** Show a permission prompt and await the user's decision. */
  canUseTool: (
    toolCall: ToolCallRequest,
    mode: ModeType,
  ) => Promise<PermissionDecision>;
  /** AskUserQuestion: prompt and return the tool output ({ answers }). */
  askQuestion: (toolCall: ToolCallRequest) => Promise<unknown>;
  /** Bash allowlist check (persisted permissions.json). */
  isCommandAllowed: (command: string) => boolean;
  /** Persist a bash pattern after an "always" grant. */
  onAlwaysAllowBash: (command: string) => void;
};

export type EngineEvent =
  | { type: "stream_start" }
  /** In-progress assistant message snapshot; replaces the previous snapshot. */
  | { type: "message_update"; message: Message }
  | { type: "tool_call"; toolCall: ToolCallRequest }
  | { type: "tool_result"; toolCallId: string; outcome: ToolOutcome }
  /** A tool result carried a modeTransition; subsequent rounds use the new mode. */
  | { type: "mode_change"; mode: ModeType }
  /** A retryable stream failure (or empty response) — the round is being retried. */
  | { type: "retry"; attempt: number; delayMs: number; error: string }
  /** Final assistant message for the turn, metadata (durationMs/usage) attached. */
  | { type: "turn_complete"; message: Message };

export type TerminalReason = "complete" | "aborted" | "max_rounds" | "error";
export type Terminal = { reason: TerminalReason; error?: unknown };

// Session identity intentionally absent: persistence and tool execution
// receive it via the host/hooks closures, keeping the engine session-agnostic.
export type QueryParams = {
  cwd: string;
  /** Full transcript including the just-submitted user message. */
  messages: Message[];
  mode: ModeType;
  modelId: string;
  reasoningEffort: ReasoningEffortLevel;
  getApiKey?: () => string | undefined;
  /** Tool execution + user-interaction callbacks. */
  host: ToolHost;
  /** Hook adapter (engine/hooks.ts). Defaults to no-op for tests. */
  hooks?: import("./hooks").EngineHooks;
  /** Session-scoped "always allow edits" flag, owned by the embedder so it
   *  survives across turns. Defaults to a per-query internal flag. */
  alwaysAllowEdits?: { get: () => boolean; set: (value: boolean) => void };
  abortSignal?: AbortSignal;
  /** Anchor for durationMs (the user's submit time). Defaults to Date.now(). */
  turnStartMs?: number;
  /** Ms spent waiting on the user this turn — subtracted from durationMs. */
  getTurnPausedMs?: () => number;
  maxRounds?: number; // default 100
  /** Max retries for a transient stream failure / empty response per round
   *  (retries only happen before any content is emitted). Default 2. */
  maxStreamRetries?: number;
  /** Context providers (memory recall, changed-file reminders). turn_start
   *  providers run once before the first response; per_round providers run
   *  after each tool round (re-primed every round). */
  contextProviders?: import("./context-providers").ContextProvider[];
  /** Max ms to wait on context providers per phase before proceeding without
   *  them, so a slow side model can't stall the turn. Default 6000. */
  contextProviderTimeoutMs?: number;
  /** Embedder session id, forwarded to context providers that need it
   *  (e.g. the changed-files reminder). */
  sessionId?: string;
  /** Restrict the toolset to these names (a forked/background agent, e.g. memory
   *  extraction). Intersected with the mode's tools. Undefined = all mode tools. */
  allowedToolNames?: string[];
};
