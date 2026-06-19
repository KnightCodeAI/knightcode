import {
  convertToModelMessages,
  streamText,
  type LanguageModelUsage,
  type ToolSet,
} from "ai";
import {
  getDeferredToolNames,
  getToolContracts,
  TASK_SUITE_TOOL_NAMES,
  type ModeType,
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
import { runContextProviders } from "./context-providers";
import { NOOP_ENGINE_HOOKS } from "./hooks";
import type { Message } from "./messages";
import { runToolCalls } from "./scheduler";
import { ToolLoopGuard } from "./tool-runner";
import { INTERRUPTED_TOOL_ERROR, repairTranscript } from "./transcript";
import { seedFileLedgerFromTranscript } from "../tools/shared/file-ledger";
import {
  backoffDelayMs,
  getRetryAfterMs,
  isRetryableError,
  sleep,
} from "./recovery";

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
  const { cwd, modelId, reasoningEffort, host, abortSignal } = params;
  const hooks = params.hooks ?? NOOP_ENGINE_HOOKS;
  const maxRounds = params.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const turnStartMs = params.turnStartMs ?? Date.now();

  // Engine State (spec): current mode (modeTransition results update it),
  // loop guard (per turn), session-scoped edit grant (embedder-owned), and
  // hook reminders pending injection into the next round.
  let mode: ModeType = params.mode;
  const loopGuard = new ToolLoopGuard();
  let internalAlwaysAllowEdits = false;
  const alwaysAllowEdits = params.alwaysAllowEdits ?? {
    get: () => internalAlwaysAllowEdits,
    set: (value: boolean) => {
      internalAlwaysAllowEdits = value;
    },
  };
  const reminders: string[] = [];

  const transcript = repairTranscript(params.messages);
  const loadedDeferred = extractLoadedDeferredTools(transcript);
  // Seed the file-read ledger from prior Read calls so the read-before-write
  // guard survives a resume (the in-memory ledger is empty after a restart).
  if (params.sessionId) {
    seedFileLedgerFromTranscript(params.sessionId, transcript, cwd);
  }

  const assistant: Message = {
    id: `asst-${crypto.randomUUID()}`,
    role: "assistant",
    parts: [],
    metadata: { mode: params.mode, model: modelId },
  } as Message;
  let usage: LanguageModelUsage | null = null;
  // OpenRouter's actual reported cost (USD), summed across this turn's rounds
  // (usage accounting, enabled in resolveModel). When OpenRouter reports a cost
  // (including 0 for free/cached turns), we use it; otherwise we default to 0,
  // treating unreported costs as free to avoid incorrect fallback pricing.
  let costUsd = 0;
  let costReported = false;

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
      costUsd: costReported ? costUsd : 0,
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
    // Context providers (engine/context-providers.ts). Output rides along as a
    // <system-reminder> in the next request — request-view only, never persisted.
    const providers = params.contextProviders ?? [];
    const providerTimeoutMs = params.contextProviderTimeoutMs ?? 6000;
    // Bound the wait: a slow provider yields no context that round rather than
    // stalling the turn. The call keeps running and may populate its own cache.
    const runProviders = async (
      phase: "turn_start" | "per_round",
      msgs: Message[],
    ): Promise<string[]> => {
      if (providers.length === 0 || abortSignal?.aborted) return [];
      return Promise.race([
        runContextProviders(providers, phase, {
          messages: msgs,
          cwd,
          sessionId: params.sessionId,
          signal: abortSignal,
        }),
        new Promise<string[]>((resolve) =>
          setTimeout(() => resolve([]), providerTimeoutMs),
        ),
      ]);
    };

    // turn_start providers (memory recall) run once, before the first response.
    reminders.push(...(await runProviders("turn_start", transcript)));

    for (let round = 0; round < maxRounds; round++) {
      if (abortSignal?.aborted) {
        yield { type: "turn_complete", message: sealTurn(true) };
        return { reason: "aborted" };
      }

      const ctx = buildRequestContext(cwd);
      if (ctx.hasPersistedTasks) {
        for (const name of TASK_SUITE_TOOL_NAMES) loadedDeferred.add(name);
      }
      let tools = getToolContracts(mode, {
        loaded_deferred: loadedDeferred,
      }) as ToolSet;
      let availableDeferredTools = getDeferredToolNames(mode).filter(
        (name) => !loadedDeferred.has(name),
      );
      // Forked/background agents (e.g. memory extraction) run a restricted
      // toolset and shouldn't be told about deferred tools they can't load.
      if (params.allowedToolNames) {
        const allow = new Set(params.allowedToolNames);
        tools = Object.fromEntries(
          Object.entries(tools).filter(([name]) => allow.has(name)),
        ) as ToolSet;
        availableDeferredTools = [];
      }

      // Test seam: a raw LanguageModel injected by unit tests.
      const testModel = (params as { modelOverrideForTest?: unknown })
        .modelOverrideForTest;
      const resolved = testModel
        ? { model: testModel as never, providerOptions: undefined }
        : resolveModel(modelId, reasoningEffort, {
            getApiKey: params.getApiKey,
            sessionId: params.sessionId,
          });

      // Hook systemMessages accumulated this turn ride along as a transient
      // user message (request-view only — never persisted to the transcript).
      // Placed AFTER the assistant message so the model sees them following
      // the tool calls/results that produced them.
      // Consume the pending reminders: each one rides along exactly once, in
      // the round after it was produced. Splicing empties the array so reminders
      // pushed while this round's tools run (below) queue for the NEXT round
      // instead of being re-injected every round forever.
      const pendingReminders = reminders.splice(0, reminders.length);
      const reminderMessage: Message | null =
        pendingReminders.length === 0
          ? null
          : ({
              id: "engine-hook-reminders",
              role: "user",
              parts: [
                {
                  type: "text",
                  text: `<system-reminder>\n${pendingReminders.join("\n\n")}\n</system-reminder>`,
                },
              ],
            } as Message);
      const requestMessages = [
        ...transcript,
        ...(assistant.parts.length > 0 ? [assistant] : []),
        ...(reminderMessage ? [reminderMessage] : []),
      ];
      // No schema re-validation of history: the transcript records what
      // happened, including tool calls whose input the executor already
      // rejected (e.g. Grep with {}). validateUIMessages would throw on those
      // forever, permanently poisoning the session. convertToModelMessages
      // only needs structural shapes, which the engine/store guarantee.
      const modelMessages = await convertToModelMessages(requestMessages, {
        tools: tools as never,
        ignoreIncompleteToolCalls: true,
      });

      // One streaming attempt: (re)creates the model stream and folds its parts
      // into `assistant`, yielding the same UI events. Returns the round's tool
      // calls. Throws on a stream `error` part — the retry loop below decides
      // whether to retry (transient + nothing emitted yet) or rethrow.
      const runStream = async function* (): AsyncGenerator<
        EngineEvent,
        {
          toolCalls: ToolCallRequest[];
          streamAborted: boolean;
          hadInvalidToolCall: boolean;
        }
      > {
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
            memoryIndex: ctx.memoryIndex,
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
        // An invalid tool call produces an output-error part but no executable
        // call; the turn must NOT end on it — the model needs the error back to
        // self-correct (see the termination guard below).
        let hadInvalidToolCall = false;

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
              // Unparsable args or unknown tool: never execute — resolve the
              // part as an error immediately so the model can self-correct on
              // the next round instead of the executor (or worse, a later
              // history pass) choking on it.
              const invalid = (part as { invalid?: boolean }).invalid === true;
              if (invalid) {
                hadInvalidToolCall = true;
                const reason = (part as { error?: unknown }).error;
                assistant.parts.push({
                  type: `tool-${part.toolName}`,
                  toolCallId: part.toolCallId,
                  state: "output-error",
                  input: part.input ?? {},
                  errorText: `Invalid tool call: ${
                    reason instanceof Error ? reason.message : String(reason ?? "unparsable arguments")
                  }`,
                } as never);
                yield { type: "message_update", message: snapshot(assistant) };
                break;
              }
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
            case "finish-step": {
              // OpenRouter surfaces the real per-request cost on the step's
              // provider metadata (usage accounting). One step per round, so sum
              // across rounds. Defensive optional-chaining: other providers / a
              // disabled flag simply leave it absent.
              const orUsage = (
                part.providerMetadata as
                  | { openrouter?: { usage?: { cost?: number } } }
                  | undefined
              )?.openrouter?.usage;
              if (typeof orUsage?.cost === "number" && Number.isFinite(orUsage.cost)) {
                costUsd += orUsage.cost;
                costReported = true;
              }
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

        return { toolCalls, streamAborted, hadInvalidToolCall };
      };

      // Retry the stream on a transient failure or empty response, but only
      // while NOTHING has been emitted this round — once content exists, a retry
      // would duplicate output / orphan tool pairs, so the error stays terminal.
      const partsBase = assistant.parts.length;
      const maxStreamRetries = params.maxStreamRetries ?? 2;
      let toolCalls: ToolCallRequest[] = [];
      let streamAborted = false;
      let hadInvalidToolCall = false;
      for (let attempt = 0; ; attempt++) {
        try {
          const out = yield* runStream();
          const emittedContent = assistant.parts.length > partsBase;
          // Empty response (no content, not aborted): retry once like a transient
          // failure; otherwise accept it (the model legitimately said nothing).
          if (
            !emittedContent &&
            !out.streamAborted &&
            !abortSignal?.aborted &&
            attempt < maxStreamRetries
          ) {
            const delayMs = backoffDelayMs(attempt);
            yield {
              type: "retry",
              attempt: attempt + 1,
              delayMs,
              error: "empty response",
            };
            await sleep(delayMs, abortSignal);
            // Abort during the backoff: stop here (the post-loop check seals an
            // aborted turn) rather than opening another stream.
            if (abortSignal?.aborted) break;
            continue;
          }
          toolCalls = out.toolCalls;
          streamAborted = out.streamAborted;
          hadInvalidToolCall = out.hadInvalidToolCall;
          break;
        } catch (err) {
          const emittedContent = assistant.parts.length > partsBase;
          const canRetry =
            !emittedContent &&
            attempt < maxStreamRetries &&
            !abortSignal?.aborted &&
            isRetryableError(err);
          if (!canRetry) throw err;
          // Drop any partial parts from the failed attempt before retrying.
          assistant.parts.length = partsBase;
          const delayMs = backoffDelayMs(attempt, getRetryAfterMs(err));
          yield {
            type: "retry",
            attempt: attempt + 1,
            delayMs,
            error: err instanceof Error ? err.message : String(err),
          };
          await sleep(delayMs, abortSignal);
          // Abort during the backoff: don't open another stream — break to the
          // post-loop check, which seals an aborted turn.
          if (abortSignal?.aborted) break;
        }
      }

      if (streamAborted || abortSignal?.aborted) {
        yield { type: "turn_complete", message: sealTurn(true) };
        return { reason: "aborted" };
      }

      // No executable tool calls. Normally that means the model is done (final
      // text answer) → complete the turn. But if the round produced an INVALID
      // tool call, the model isn't done — it emitted a malformed call, got an
      // error part back, and must be given another round to self-correct. Loop
      // instead of terminating (runToolCalls below is a no-op on empty calls).
      if (toolCalls.length === 0 && !hadInvalidToolCall) {
        yield { type: "turn_complete", message: sealTurn(false) };
        return { reason: "complete" };
      }

      const scheduler = runToolCalls({
        toolCalls,
        host,
        hooks,
        getMode: () => mode,
        loopGuard,
        alwaysAllowEdits,
        abortSignal,
      });
      while (true) {
        const step = await scheduler.next();
        if (step.done) {
          reminders.push(...step.value);
          break;
        }
        const ev = step.value;
        if (ev.type === "tool_start") {
          yield { type: "tool_call", toolCall: ev.toolCall };
          continue;
        }
        const toolPart = assistant.parts.find(
          (p) => (p as never as ToolPart).toolCallId === ev.toolCallId,
        ) as never as ToolPart | undefined;
        if (toolPart) {
          if (ev.outcome.kind === "output") {
            toolPart.state = "output-available";
            toolPart.output = ev.outcome.output;
          } else {
            toolPart.state = "output-error";
            toolPart.errorText = ev.outcome.errorText;
          }
          const found = toolCalls.find((c) => c.toolCallId === ev.toolCallId);
          if (found) trackToolSearchLoads(found, ev.outcome, loadedDeferred);
        }
        // Mode transitions (EnterPlanMode/ExitPlanMode) update engine State so
        // later rounds gate and assemble tools under the new mode.
        if (
          ev.outcome.kind === "output" &&
          ev.outcome.output &&
          typeof ev.outcome.output === "object" &&
          "modeTransition" in ev.outcome.output
        ) {
          mode = (ev.outcome.output as { modeTransition: ModeType })
            .modeTransition;
          yield { type: "mode_change", mode };
        }
        yield { type: "tool_result", toolCallId: ev.toolCallId, outcome: ev.outcome };
        yield { type: "message_update", message: snapshot(assistant) };
      }

      if (abortSignal?.aborted) {
        yield { type: "turn_complete", message: sealTurn(true) };
        return { reason: "aborted" };
      }

      // per_round providers (changed-file reminders, etc.) run after the tool
      // round; their output is consumed by the next round's request.
      reminders.push(
        ...(await runProviders("per_round", [...transcript, assistant])),
      );
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
