import type { ToolHost } from "../engine/events";
import { executeRegisteredTool } from "../tools";

/**
 * A ToolHost for forked/background agents (memory extraction, consolidation).
 * Executes tools directly with no user interaction — it runs in AUTO mode so
 * the engine gate never asks for permission, and there is no user to prompt.
 * `onToolResult` lets the caller observe what the agent did (e.g. count saves).
 */
export function createBackgroundToolHost(opts: {
  cwd: string;
  sessionId: string;
  onToolResult?: (toolName: string, output: unknown) => void;
}): ToolHost {
  return {
    executeTool: async (toolCall, mode, o) => {
      const output = await executeRegisteredTool(
        toolCall.toolName,
        toolCall.input,
        mode,
        opts.sessionId,
        { cwd: opts.cwd, modelOverride: o.modelOverride },
      );
      opts.onToolResult?.(toolCall.toolName, output);
      return output;
    },
    canUseTool: async () => ({ behavior: "allow" }),
    askQuestion: async () => {
      throw new Error("AskUserQuestion is not available to a background agent");
    },
    isCommandAllowed: () => false,
    onAlwaysAllowBash: () => {},
  };
}
