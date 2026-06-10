import {
  convertToModelMessages,
  streamText,
  validateUIMessages,
  type LanguageModelUsage,
  type ToolSet,
} from "ai";
import {
  getDeferredToolNames,
  getToolContracts,
  TASK_SUITE_TOOL_NAMES,
} from "@repo/shared";
import { buildRequestContext } from "../inference/build-request-context";
import { buildSystemPrompt } from "../inference/system-prompt";
import { extractLoadedDeferredTools } from "../inference/loaded-deferred-tools";
import { resolveModel } from "../inference/resolve-model";
import type {
  EngineEvent,
  QueryParams,
  Terminal,
  ToolCallRequest,
  ToolOutcome,
} from "./events";
import type { Message } from "./messages";
import { INTERRUPTED_TOOL_ERROR, repairTranscript } from "./transcript";

const DEFAULT_MAX_ROUNDS = 100;

type ToolPart = {
  type: string;
  toolCallId: string;
  state: string;
  input: unknown;
  output?: unknown;
  errorText?: string;
};

function addUsage(
  acc: LanguageModelUsage | null,
  u: LanguageModelUsage | undefined,
): LanguageModelUsage | null {
  if (!u) return acc;
  if (!acc) return u;
  return {
    ...acc,
    inputTokens: (acc.inputTokens ?? 0) + (u.inputTokens ?? 0),
    outputTokens: (acc.outputTokens ?? 0) + (u.outputTokens ?? 0),
    totalTokens: (acc.totalTokens ?? 0) + (u.totalTokens ?? 0),
  };
}

function snapshot(message: Message): Message {
  return { ...message, parts: [...message.parts] };
}

/** Record ToolSearch matches so later rounds include the loaded schemas. */
function trackToolSearchLoads(
  toolCall: ToolCallRequest,
  outcome: ToolOutcome,
  loaded: Set<string>,
): void {
  if (toolCall.toolName !== "ToolSearch" || outcome.kind !== "output") return;
  const matches = (outcome.output as { matches?: unknown })?.matches;
  if (!Array.isArray(matches)) return;
  for (const m of matches) {
    const name = (m as { name?: unknown })?.name;
    if (typeof name === "string") loaded.add(name);
  }
}

export async function* query(
  params: QueryParams,
): AsyncGenerator<EngineEvent, Terminal> {
  const { cwd, mode, modelId, reasoningEffort, runTool, abortSignal } = params;
  const maxRounds = params.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const turnStartMs = params.turnStartMs ?? Date.now();

  const transcript = repairTranscript(params.messages);
  const loadedDeferred = extractLoadedDeferredTools(transcript);

  const assistant: Message = {
    id: `asst-${crypto.randomUUID()}`,
    role: "assistant",
    parts: [],
    metadata: { mode, model: modelId },
  } as Message;
  let usage: LanguageModelUsage | null = null;

  // Stamps final metadata on the assistant message. Called exactly once.
  const sealTurn = (interrupted: boolean): Message => {
    const pausedMs = params.getTurnPausedMs?.() ?? 0;
    assistant.metadata = {
      ...assistant.metadata,
      durationMs: Math.max(
        0,
        Date.now() - turnStartMs - (Number.isFinite(pausedMs) ? pausedMs : 0),
      ),
      ...(usage ? { usage } : {}),
      ...(interrupted ? { isInterrupted: true } : {}),
    };
    // Resolve any tool parts that never got a result (abort/error paths).
    assistant.parts = assistant.parts.map((part) => {
      const p = part as never as ToolPart;
      if (
        typeof p?.type === "string" &&
        (p.type.startsWith("tool-") || p.type === "dynamic-tool") &&
        (p.state === "input-available" || p.state === "input-streaming")
      ) {
        return {
          ...p,
          state: "output-error",
          errorText: INTERRUPTED_TOOL_ERROR,
        } as never;
      }
      return part;
    }) as Message["parts"];
    return snapshot(assistant);
  };

  try {
    for (let round = 0; round < maxRounds; round++) {
      if (abortSignal?.aborted) {
        yield { type: "turn_complete", message: sealTurn(true) };
        return { reason: "aborted" };
      }

      const ctx = buildRequestContext(cwd);
      if (ctx.hasPersistedTasks) {
        for (const name of TASK_SUITE_TOOL_NAMES) loadedDeferred.add(name);
      }
      const tools = getToolContracts(mode, {
        loaded_deferred: loadedDeferred,
      }) as ToolSet;
      const availableDeferredTools = getDeferredToolNames(mode).filter(
        (name) => !loadedDeferred.has(name),
      );

      // Test seam: a raw LanguageModel injected by unit tests.
      const testModel = (params as { modelOverrideForTest?: unknown })
        .modelOverrideForTest;
      const resolved = testModel
        ? { model: testModel as never, providerOptions: undefined }
        : resolveModel(modelId, reasoningEffort, {
            getApiKey: params.getApiKey,
          });

      const requestMessages =
        assistant.parts.length > 0 ? [...transcript, assistant] : transcript;
      const validated = await validateUIMessages({
        messages: requestMessages,
        tools: tools as never,
      });
      const modelMessages = await convertToModelMessages(validated, {
        tools: tools as never,
      });

      yield { type: "stream_start" };

      const result = streamText({
        model: resolved.model,
        system: buildSystemPrompt({
          mode,
          globalInstructions: ctx.globalInstructions,
          projectInstructions: ctx.projectInstructions,
          localInstructions: ctx.localInstructions,
          rules: ctx.rules,
          skillIndex: ctx.skillIndex,
          gitBranchName: ctx.gitBranchName,
          gitStatus: ctx.gitStatus,
          gitDiffSummary: ctx.gitDiffSummary,
          frameworks: ctx.frameworks,
          packageManager: ctx.packageManager,
          isTypeScript: ctx.isTypeScript,
          shellName: ctx.shellName,
          platform: ctx.platform,
          availableDeferredTools,
          agentTypes: ctx.agentTypes,
        }),
        messages: modelMessages,
        tools,
        providerOptions: resolved.providerOptions,
        abortSignal,
      });

      // Assemble assistant parts from the raw stream.
      const toolCalls: ToolCallRequest[] = [];
      let activeText: { type: "text"; text: string } | null = null;
      let activeReasoning: { type: "reasoning"; text: string } | null = null;
      // streamText doesn't throw on abort mid-stream: it emits a graceful
      // `abort` part and ends the stream, so track it explicitly.
      let streamAborted = false;

      for await (const part of result.fullStream) {
        switch (part.type) {
          case "text-start":
            activeText = { type: "text", text: "" };
            assistant.parts.push(activeText as never);
            break;
          case "text-delta":
            if (activeText) {
              activeText.text += part.text;
              yield { type: "message_update", message: snapshot(assistant) };
            }
            break;
          case "text-end":
            activeText = null;
            break;
          case "reasoning-start":
            activeReasoning = { type: "reasoning", text: "" };
            assistant.parts.push(activeReasoning as never);
            break;
          case "reasoning-delta":
            if (activeReasoning) {
              activeReasoning.text += part.text;
              yield { type: "message_update", message: snapshot(assistant) };
            }
            break;
          case "reasoning-end":
            activeReasoning = null;
            break;
          case "tool-call": {
            const toolCall: ToolCallRequest = {
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: part.input,
            };
            toolCalls.push(toolCall);
            assistant.parts.push({
              type: `tool-${part.toolName}`,
              toolCallId: part.toolCallId,
              state: "input-available",
              input: part.input,
            } as never);
            yield { type: "message_update", message: snapshot(assistant) };
            break;
          }
          case "finish":
            usage = addUsage(usage, part.totalUsage);
            break;
          case "abort":
            streamAborted = true;
            break;
          case "error":
            throw part.error instanceof Error
              ? part.error
              : new Error(String(part.error));
          default:
            break;
        }
      }

      if (streamAborted || abortSignal?.aborted) {
        yield { type: "turn_complete", message: sealTurn(true) };
        return { reason: "aborted" };
      }

      if (toolCalls.length === 0) {
        yield { type: "turn_complete", message: sealTurn(false) };
        return { reason: "complete" };
      }

      for (const toolCall of toolCalls) {
        if (abortSignal?.aborted) break;
        yield { type: "tool_call", toolCall };
        if (abortSignal?.aborted) break; // re-check: consumer may abort on the event
        let outcome: ToolOutcome;
        try {
          outcome = await runTool(toolCall);
        } catch (err) {
          outcome = {
            kind: "error",
            errorText: err instanceof Error ? err.message : String(err),
          };
        }
        const toolPart = assistant.parts.find(
          (p) => (p as never as ToolPart).toolCallId === toolCall.toolCallId,
        ) as never as ToolPart | undefined;
        if (toolPart) {
          if (outcome.kind === "output") {
            toolPart.state = "output-available";
            toolPart.output = outcome.output;
          } else {
            toolPart.state = "output-error";
            toolPart.errorText = outcome.errorText;
          }
        }
        trackToolSearchLoads(toolCall, outcome, loadedDeferred);
        yield { type: "tool_result", toolCallId: toolCall.toolCallId, outcome };
        yield { type: "message_update", message: snapshot(assistant) };
      }

      if (abortSignal?.aborted) {
        yield { type: "turn_complete", message: sealTurn(true) };
        return { reason: "aborted" };
      }
      // next round continues with the same assistant message accumulating parts
    }
    yield { type: "turn_complete", message: sealTurn(false) };
    return { reason: "max_rounds" };
  } catch (err) {
    const aborted =
      abortSignal?.aborted ||
      (err instanceof Error && err.name === "AbortError");
    yield { type: "turn_complete", message: sealTurn(true) };
    return aborted ? { reason: "aborted" } : { reason: "error", error: err };
  }
}
