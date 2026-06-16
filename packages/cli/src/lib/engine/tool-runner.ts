import type { ModeType } from "@repo/shared";

export type ToolGateDecision = "execute" | "confirm" | "todo";

const FILE_EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

/**
 * Pure gating decision, ported from use-chat's onToolCall. AUTO mode
 * short-circuits every permission gate except AskUserQuestion (a question is
 * not a permission — the model explicitly wants user input).
 */
export function gateToolCall(opts: {
  toolName: string;
  input: unknown;
  mode: ModeType;
  alwaysAllowEdits: boolean;
  isCommandAllowed: (command: string) => boolean;
}): ToolGateDecision {
  const { toolName, input, mode, alwaysAllowEdits, isCommandAllowed } = opts;

  if (toolName === "TodoWrite") return "todo";
  if (toolName === "AskUserQuestion") return "confirm";
  if (mode === "AUTO") return "execute";

  if (FILE_EDIT_TOOLS.has(toolName) && !alwaysAllowEdits) return "confirm";
  if (toolName === "Bash") {
    const command = String((input as { command?: unknown })?.command ?? "");
    if (!isCommandAllowed(command)) return "confirm";
    return "execute";
  }
  if (
    toolName === "Config" &&
    (input as { value?: unknown })?.value !== undefined
  ) {
    return "confirm";
  }
  if (toolName === "Agent") return "confirm";
  if (toolName === "Memory") {
    const action = (input as { action?: unknown })?.action;
    return action === "delete" || action === "update" ? "confirm" : "execute";
  }

  return "execute";
}

const LOOP_LIMIT = 8;

/** Per-turn repeated-call guard (toolName + serialized input). */
export class ToolLoopGuard {
  private counts = new Map<string, number>();

  /** Returns false when the call should be rejected as a loop. */
  check(toolName: string, input: unknown): boolean {
    if (toolName === "TodoWrite") return true;
    const key = `${toolName}:${JSON.stringify(input ?? {})}`;
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return count <= LOOP_LIMIT;
  }

  reset(): void {
    this.counts.clear();
  }
}

export const LOOP_PROTECTION_ERROR =
  "Loop protection stopped this repeated tool call. Adjust the input or ask the user before retrying.";
