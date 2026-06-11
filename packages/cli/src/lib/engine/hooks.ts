import {
  runPostToolHooks,
  runPostToolUseFailureHooks,
  runPreToolHooks,
} from "../hooks";

export type EnginePreToolResult = {
  blocked: boolean;
  reason?: string;
  systemMessage?: string;
};

export type EnginePostToolResult = { systemMessage?: string };

/**
 * The engine's view of the user hook system. Injected (closed over sessionId
 * by the embedder) so the engine stays session-agnostic and unit-testable.
 */
export type EngineHooks = {
  preToolUse: (toolName: string, input: unknown) => Promise<EnginePreToolResult>;
  postToolUse: (
    toolName: string,
    input: unknown,
    output: unknown,
  ) => Promise<EnginePostToolResult>;
  postToolUseFailure: (
    toolName: string,
    input: unknown,
    error: string,
  ) => Promise<void>;
};

export const NOOP_ENGINE_HOOKS: EngineHooks = {
  preToolUse: async () => ({ blocked: false }),
  postToolUse: async () => ({}),
  postToolUseFailure: async () => {},
};

/** Production adapter over lib/hooks.ts, bound to a session. */
export function createEngineHooks(sessionId: string): EngineHooks {
  return {
    preToolUse: (toolName, input) => runPreToolHooks(toolName, input, sessionId),
    postToolUse: (toolName, input, output) =>
      runPostToolHooks(toolName, input, output, sessionId),
    postToolUseFailure: (toolName, input, error) =>
      runPostToolUseFailureHooks(toolName, input, error, sessionId),
  };
}
