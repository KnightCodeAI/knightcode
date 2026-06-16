import { getKnightcodeTool, type ModeType } from "@repo/shared";
import type {
  ToolCallRequest,
  ToolHost,
  ToolOutcome,
} from "./events";
import type { EngineHooks } from "./hooks";
import {
  gateToolCall,
  LOOP_PROTECTION_ERROR,
  ToolLoopGuard,
} from "./tool-runner";

/** Max concurrently executing tools inside one safe batch. */
const MAX_TOOL_CONCURRENCY = 10;

const FILE_EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

export type SchedulerEvent =
  | { type: "tool_start"; toolCall: ToolCallRequest }
  | { type: "tool_result"; toolCallId: string; outcome: ToolOutcome };

export type SchedulerParams = {
  toolCalls: ToolCallRequest[];
  host: ToolHost;
  hooks: EngineHooks;
  /** Live mode lookup — EnterPlanMode/ExitPlanMode results change it mid-round. */
  getMode: () => ModeType;
  loopGuard: ToolLoopGuard;
  alwaysAllowEdits: { get: () => boolean; set: (value: boolean) => void };
  abortSignal?: AbortSignal;
};

export type ToolBatch = { safe: boolean; calls: ToolCallRequest[] };

/**
 * Partition a round's tool calls into batches: contiguous concurrency-safe
 * calls group together (run in parallel); every unsafe call is its own
 * serial batch. Unknown tools are conservatively unsafe.
 */
export function partitionToolCalls(calls: ToolCallRequest[]): ToolBatch[] {
  return calls.reduce<ToolBatch[]>((acc, call) => {
    const safe =
      getKnightcodeTool(call.toolName)?.is_concurrency_safe ?? false;
    const last = acc[acc.length - 1];
    if (safe && last?.safe) {
      last.calls.push(call);
    } else {
      acc.push({ safe, calls: [call] });
    }
    return acc;
  }, []);
}

/** Single-consumer event channel bridging parallel executors to the generator. */
function createChannel<T>() {
  const buffer: T[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  return {
    push(item: T) {
      buffer.push(item);
      wake?.();
      wake = null;
    },
    close() {
      closed = true;
      wake?.();
      wake = null;
    },
    async *drain(): AsyncGenerator<T, void> {
      while (true) {
        while (buffer.length > 0) yield buffer.shift()!;
        if (closed) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}

// Handoff semaphore: release() transfers the slot directly to the next
// waiter (active stays constant) instead of decrementing and letting the
// waiter re-increment — a sync acquire arriving between those two microtasks
// could otherwise exceed the cap.
function createSemaphore(limit: number) {
  let active = 0;
  const waiters: Array<() => void> = [];
  return {
    async acquire() {
      if (active < limit) {
        active++;
        return;
      }
      await new Promise<void>((resolve) => waiters.push(resolve));
    },
    release() {
      const next = waiters.shift();
      if (next) {
        next();
      } else {
        active--;
      }
    },
  };
}

/**
 * The full per-call pipeline. Every path returns a ToolOutcome — the
 * scheduler, not callers, guarantees tool_use/tool_result pairing.
 * Order: loop guard → zod parse → PreToolUse hooks (block beats prompt) →
 * gate → canUseTool/askQuestion → execute → PostToolUse.
 */
async function executeOne(
  toolCall: ToolCallRequest,
  params: SchedulerParams,
  reminders: string[],
): Promise<ToolOutcome> {
  const { host, hooks } = params;
  const { toolName, input } = toolCall;

  if (!params.loopGuard.check(toolName, input)) {
    return { kind: "error", errorText: LOOP_PROTECTION_ERROR };
  }

  const contract = getKnightcodeTool(toolName);
  if (contract) {
    const parsed = contract.input_schema.safeParse(input);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(input)"}: ${i.message}`)
        .join("; ");
      return {
        kind: "error",
        errorText: `Invalid input for ${toolName}: ${issues}`,
      };
    }
  }

  let pre: Awaited<ReturnType<EngineHooks["preToolUse"]>>;
  try {
    pre = await hooks.preToolUse(toolName, input);
  } catch {
    pre = { blocked: false };
  }
  if (pre.systemMessage) reminders.push(pre.systemMessage);
  if (pre.blocked) {
    return {
      kind: "error",
      errorText: pre.reason
        ? `Hook blocked tool ${toolName}: ${pre.reason}`
        : `Hook blocked tool ${toolName}`,
    };
  }

  const mode = params.getMode();
  const decision = gateToolCall({
    toolName,
    input,
    mode,
    alwaysAllowEdits: params.alwaysAllowEdits.get(),
    isCommandAllowed: host.isCommandAllowed,
  });

  let modelOverride: string | undefined;
  if (decision === "confirm") {
    if (toolName === "AskUserQuestion") {
      // A throw here (e.g. the host's prompt UI rejecting) must not escape
      // executeOne — that would abort the round and orphan the tool_use with
      // no matching tool_result. Surface it as the tool's error instead.
      try {
        const output = await host.askQuestion(toolCall);
        return { kind: "output", output };
      } catch (err) {
        return {
          kind: "error",
          errorText: err instanceof Error ? err.message : String(err),
        };
      }
    }
    let granted: Awaited<ReturnType<ToolHost["canUseTool"]>>;
    try {
      granted = await host.canUseTool(toolCall, mode);
    } catch (err) {
      // Same contract as above: a failed permission prompt becomes a tool
      // error so the round keeps its tool_use/tool_result pairing.
      return {
        kind: "error",
        errorText: err instanceof Error ? err.message : String(err),
      };
    }
    if (granted.behavior === "deny") {
      return {
        kind: "error",
        errorText: granted.feedback?.trim()
          ? `User declined this change. Guidance: ${granted.feedback.trim()}`
          : "User rejected the changes",
      };
    }
    if (granted.always) {
      if (toolName === "Bash") {
        const command = (input as { command?: string })?.command;
        if (typeof command === "string" && command.trim()) {
          host.onAlwaysAllowBash(command);
        }
      } else if (FILE_EDIT_TOOLS.has(toolName)) {
        params.alwaysAllowEdits.set(true);
      }
    }
    modelOverride = granted.modelOverride;
  }

  try {
    const output = await host.executeTool(toolCall, mode, { modelOverride });
    try {
      const post = await hooks.postToolUse(toolName, input, output);
      if (post.systemMessage) reminders.push(post.systemMessage);
    } catch {
      // post hooks must never fail the tool
    }
    return { kind: "output", output };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await hooks.postToolUseFailure(toolName, input, message);
    } catch {
      // failure hooks must never mask the original error
    }
    return { kind: "error", errorText: message };
  }
}

/**
 * Run one round's tool calls: safe batches concurrent (cap 10), unsafe
 * serial, abort stops scheduling (in-flight calls run to completion).
 * Returns the hook systemMessages collected this round.
 */
export async function* runToolCalls(
  params: SchedulerParams,
): AsyncGenerator<SchedulerEvent, string[]> {
  const reminders: string[] = [];

  for (const batch of partitionToolCalls(params.toolCalls)) {
    if (params.abortSignal?.aborted) break;

    if (batch.safe && batch.calls.length > 1) {
      const channel = createChannel<SchedulerEvent>();
      const semaphore = createSemaphore(MAX_TOOL_CONCURRENCY);
      const work = Promise.all(
        batch.calls.map(async (toolCall) => {
          await semaphore.acquire();
          try {
            if (params.abortSignal?.aborted) return;
            channel.push({ type: "tool_start", toolCall });
            const outcome = await executeOne(toolCall, params, reminders);
            channel.push({
              type: "tool_result",
              toolCallId: toolCall.toolCallId,
              outcome,
            });
          } finally {
            semaphore.release();
          }
        }),
      );
      void work.then(
        () => channel.close(),
        () => channel.close(),
      );
      yield* channel.drain();
      await work;
    } else {
      for (const toolCall of batch.calls) {
        if (params.abortSignal?.aborted) break;
        yield { type: "tool_start", toolCall };
        if (params.abortSignal?.aborted) break; // consumer may abort on the event
        const outcome = await executeOne(toolCall, params, reminders);
        yield {
          type: "tool_result",
          toolCallId: toolCall.toolCallId,
          outcome,
        };
      }
    }
  }

  return reminders;
}
