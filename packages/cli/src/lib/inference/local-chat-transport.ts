import {
  DEFAULT_CHAT_MODEL_ID,
  getDeferredToolNames,
  getToolContracts,
  TASK_SUITE_TOOL_NAMES,
  type ModeType,
  type ReasoningEffortLevel,
} from "@knightcode/shared";
import {
  convertToModelMessages,
  streamText,
  validateUIMessages,
  type ChatTransport,
  type LanguageModelUsage,
  type ToolSet,
  type UIMessageChunk,
} from "ai";
import type { Message } from "../../hooks/use-chat";
import { getSession } from "../store";
import { getStore } from "../store/client";
import { ensureSession, replaceSessionMessages } from "../store/conversation";
import { buildRequestContext } from "./build-request-context";
import { extractLoadedDeferredTools } from "./loaded-deferred-tools";
import { resolveModel } from "./resolve-model";
import { buildSystemPrompt } from "./system-prompt";

export type LocalChatTransportOptions = {
  sessionId: string;
  cwd?: string;
  defaultMode?: ModeType;
  getApiKey?: () => string | undefined;
};

/**
 * AI SDK ChatTransport that streams directly from OpenRouter instead of POSTing
 * to a server. Builds the system prompt + tool set locally, runs streamText,
 * and returns its UI-message stream — preserving useChat's tool-loop state
 * machine. Persists the finished transcript to the local sqlite store.
 */
export class LocalChatTransport implements ChatTransport<Message> {
  constructor(private readonly options: LocalChatTransportOptions) {}

  async sendMessages(
    options: Parameters<ChatTransport<Message>["sendMessages"]>[0],
  ): Promise<ReadableStream<UIMessageChunk>> {
    const { messages, abortSignal } = options;
    const cwd = this.options.cwd ?? process.cwd();
    const sessionId = this.options.sessionId;

    const last = messages[messages.length - 1];
    const metaSource = messages.findLast(
      (m) => m.metadata?.mode && m.metadata?.model,
    )?.metadata;
    const mode: ModeType = (last?.metadata?.mode ??
      metaSource?.mode ??
      this.options.defaultMode ??
      "BUILD") as ModeType;
    const modelId =
      last?.metadata?.model ?? metaSource?.model ?? DEFAULT_CHAT_MODEL_ID;

    // Reasoning effort flows per-turn via message metadata (like mode/model),
    // so a mid-session change reaches inference immediately; the stored session
    // row is only a fallback for messages that predate the metadata.
    const reasoningEffort = (last?.metadata?.reasoningEffort ??
      metaSource?.reasoningEffort ??
      getSession(getStore(), sessionId)?.reasoningEffort ??
      "medium") as ReasoningEffortLevel;

    const ctx = buildRequestContext(cwd);

    // Tool assembly mirrors the old server route: base + already-loaded
    // deferred tools (+ the Task suite when the workspace has pending tasks),
    // and announce the still-unloaded deferred tools via the system prompt.
    const loadedDeferred = extractLoadedDeferredTools(messages);
    if (ctx.hasPersistedTasks) {
      for (const name of TASK_SUITE_TOOL_NAMES) loadedDeferred.add(name);
    }
    const tools = getToolContracts(mode, {
      loaded_deferred: loadedDeferred,
    }) as ToolSet;
    const availableDeferredTools = getDeferredToolNames(mode).filter(
      (name) => !loadedDeferred.has(name),
    );

    const resolved = resolveModel(modelId, reasoningEffort, {
      getApiKey: this.options.getApiKey,
    });

    const validated = await validateUIMessages<Message>({
      messages,
      tools: tools as never,
    });
    const modelMessages = await convertToModelMessages(validated, {
      tools: tools as never,
    });

    const startTime = Date.now();
    let accumulatedUsage: LanguageModelUsage | null = null;

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
      onStepFinish(event) {
        const u = event.usage;
        if (!u) return;
        accumulatedUsage = accumulatedUsage
          ? {
              ...accumulatedUsage,
              inputTokens:
                (accumulatedUsage.inputTokens ?? 0) + (u.inputTokens ?? 0),
              outputTokens:
                (accumulatedUsage.outputTokens ?? 0) + (u.outputTokens ?? 0),
              totalTokens:
                (accumulatedUsage.totalTokens ?? 0) + (u.totalTokens ?? 0),
            }
          : u;
      },
    });

    return result.toUIMessageStream<Message>({
      originalMessages: validated,
      messageMetadata: ({ part }) => {
        if (part.type === "start") return { mode, model: modelId };
        if (part.type !== "finish") return undefined;
        return {
          mode,
          model: modelId,
          durationMs: Date.now() - startTime,
          ...(accumulatedUsage ? { usage: accumulatedUsage } : {}),
        };
      },
      onFinish: ({ messages: finalMessages, isAborted }) => {
        try {
          // Defensive: guarantee the FK parent exists before writing messages.
          const firstUserText = finalMessages
            .find((m) => m.role === "user")
            ?.parts.find((p): p is { type: "text"; text: string } => p.type === "text")
            ?.text;
          ensureSession(getStore(), {
            id: sessionId,
            directory: cwd,
            title: firstUserText?.slice(0, 100) || "Untitled",
            model: modelId,
            reasoningEffort,
          });
          const persisted = isAborted
            ? finalMessages.map((m, i) =>
                i === finalMessages.length - 1 && m.role === "assistant"
                  ? { ...m, metadata: { ...m.metadata, isInterrupted: true } }
                  : m,
              )
            : finalMessages;
          replaceSessionMessages(getStore(), sessionId, persisted as never);
        } catch (err) {
          console.error("Failed to persist conversation:", err);
        }
      },
      onError: (error) =>
        error instanceof Error ? error.message : String(error),
    }) as unknown as ReadableStream<UIMessageChunk>;
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    // No resumable server-side streams in local mode.
    return null;
  }
}
