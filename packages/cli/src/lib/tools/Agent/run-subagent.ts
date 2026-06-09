import type { ModeType } from "@repo/shared";
import type { ModelMessage } from "ai";

export interface SubagentStepResult {
  text: string;
  toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>;
  finishReason: string;
  usage: unknown;
}

export interface RunSubagentParams {
  system: string;
  prompt: string;
  toolNames: string[];
  mode: ModeType;
  model: string;
  maxTurns: number;
  cwd?: string;
  /** Calls the /agent-step endpoint (injected for testability). */
  callStep: (req: {
    system: string;
    messages: ModelMessage[];
    toolNames: string[];
    mode: ModeType;
    model: string;
  }) => Promise<SubagentStepResult>;
  /** Executes a tool locally (wraps executeLocalTool with cwd). */
  executeTool: (toolName: string, input: unknown) => Promise<unknown>;
  /** Foreground: ask the user. Background: returns false. */
  requestPermission: (toolCall: {
    toolCallId: string;
    toolName: string;
    input: unknown;
  }) => Promise<boolean>;
  /** Whether a given tool call requires confirmation in this mode. */
  needsPermission: (toolName: string, input: unknown) => boolean;
  abortSignal?: AbortSignal;
}

export interface RunSubagentResult {
  text: string;
  stoppedReason: "complete" | "max_turns" | "aborted";
}

export async function runSubagentLoop(
  params: RunSubagentParams,
): Promise<RunSubagentResult> {
  const messages: ModelMessage[] = [{ role: "user", content: params.prompt }];
  let lastText = "";

  for (let turn = 0; turn < params.maxTurns; turn++) {
    if (params.abortSignal?.aborted)
      return { text: lastText, stoppedReason: "aborted" };

    const step = await params.callStep({
      system: params.system,
      messages,
      toolNames: params.toolNames,
      mode: params.mode,
      model: params.model,
    });
    if (step.text) lastText = step.text;

    if (step.toolCalls.length === 0) {
      return { text: lastText, stoppedReason: "complete" };
    }

    // Record the assistant turn (tool-call content) so the next step sees it.
    messages.push({
      role: "assistant",
      content: step.toolCalls.map((tc) => ({
        type: "tool-call" as const,
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        input: tc.input,
      })),
    });

    for (const tc of step.toolCalls) {
      let output: unknown;
      if (params.needsPermission(tc.toolName, tc.input)) {
        const allowed = await params.requestPermission(tc);
        output = allowed
          ? await params.executeTool(tc.toolName, tc.input)
          : { error: "Permission denied by user." };
      } else {
        try {
          output = await params.executeTool(tc.toolName, tc.input);
        } catch (err) {
          output = { error: err instanceof Error ? err.message : String(err) };
        }
      }
      messages.push({
        role: "tool",
        content: [
          {
            type: "tool-result" as const,
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            output: { type: "json", value: output as never },
          },
        ],
      });
    }
  }

  return { text: lastText, stoppedReason: "max_turns" };
}
