import { useChat as useAiChat } from "@ai-sdk/react";
import {
  type ModeType,
  type ReasoningEffortLevel,
  type SupportedChatModelId,
  type ToolContracts,
  findSupportedChatModel,
  DEFAULT_CHAT_MODEL_ID,
} from "@repo/shared";
import {
  dequeueNotification,
  hasNotifications,
} from "../lib/tools/Agent/notifications";
import {
  lastAssistantMessageIsCompleteWithToolCalls,
  type InferUITools,
  type LanguageModelUsage,
  type UIMessage,
} from "ai";
import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { LocalChatTransport } from "../lib/inference/local-chat-transport";
import { compactConversation } from "../lib/inference/compact-conversation";
import { getStore } from "../lib/store/client";
import { replaceSessionMessages } from "../lib/store/conversation";
import { getOpenRouterApiKey } from "../lib/credentials";
import { executeLocalTool, getSessionModifiedFiles } from "../lib/tools";
import { allowCommand, isCommandAllowed } from "../lib/permissions/permissions";

import {
  runUserPromptSubmitHooks,
  runStopHooks,
  type UserPromptHookResult,
} from "../lib/hooks";
import { useTodo, type TodoItem } from "../providers/todo";
import { useToast } from "../providers/toast";

export type ChatMessageMetadata = {
  mode?: ModeType;
  model?: SupportedChatModelId | string;
  reasoningEffort?: ReasoningEffortLevel;
  /** Wall-clock ms when the user submitted this prompt; anchors turn timing. */
  submittedAt?: number;
  durationMs?: number;
  usage?: LanguageModelUsage;
  isCompaction?: boolean;
  isInterrupted?: boolean;
  originalMessageCount?: number;
  summaryCount?: number;
  preservedCount?: number;
  commandProgressMessage?: string;
};

type ChatTools = {
  [Name in keyof InferUITools<ToolContracts>]: {
    input: InferUITools<ToolContracts>[Name]["input"];
    output: unknown;
  };
};

export type Message = UIMessage<ChatMessageMetadata, never, ChatTools>;

export type PendingConfirmation = {
  toolCallId: string;
  toolCall: {
    toolCallId: string;
    toolName: string;
    input: any;
  };
  mode: ModeType;
  modelOverride?: SupportedChatModelId;
};

export function useChat(
  sessionId: string,
  initialMessages: Message[],
  options?: { onModeChange?: (mode: ModeType) => void },
) {
  const toast = useToast();
  const [pendingConfirmations, setPendingConfirmations] = useState<
    PendingConfirmation[]
  >([]);
  const [alwaysAllowEdits, setAlwaysAllowEditsState] = useState(false);
  const alwaysAllowEditsRef = useRef(false);
  const chatRef = useRef<any>(null);
  const toolLoopCountsRef = useRef(new Map<string, number>());
  // Resolvers for promise-based permission requests (used by foreground
  // subagents that route their tool prompts through pendingConfirmations).
  const permissionResolversRef = useRef(
    new Map<string, (allowed: boolean) => void>(),
  );
  const [isCompacting, setIsCompacting] = useState(false);
  const isCompactingRef = useRef(false);
  // Turn-timer pausing: while the assistant waits on the user (a permission
  // prompt or AskUserQuestion), the elapsed clock freezes — matching the reference TUI,
  // so "thinking" time excludes the human's decision time.
  const turnPausedMsRef = useRef(0);
  const pauseStartRef = useRef<number | null>(null);
  const getTurnPausedMs = useCallback(() => {
    const live =
      pauseStartRef.current !== null ? Date.now() - pauseStartRef.current : 0;
    return turnPausedMsRef.current + live;
  }, []);
  const { setItems: setTodoItems } = useTodo();
  const todoRef = useRef(setTodoItems);
  todoRef.current = setTodoItems;

  const setAlwaysAllowEdits = useCallback((val: boolean) => {
    setAlwaysAllowEditsState(val);
    alwaysAllowEditsRef.current = val;
  }, []);

  const transport = useMemo(() => {
    return new LocalChatTransport({
      sessionId,
      cwd: process.cwd(),
      getApiKey: getOpenRouterApiKey,
      getTurnPausedMs,
    });
  }, [sessionId, getTurnPausedMs]);

  const requestToolPermission = useCallback(
    (
      toolCall: { toolCallId: string; toolName: string; input: any },
      mode: ModeType,
    ): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        permissionResolversRef.current.set(toolCall.toolCallId, resolve);
        setPendingConfirmations((prev) => [
          ...prev,
          { toolCallId: toolCall.toolCallId, toolCall, mode },
        ]);
      }),
    [],
  );

  const executeAndOutput = useCallback(
    async (p: PendingConfirmation) => {
      try {
        const output = await executeLocalTool(
          p.toolCall.toolName,
          p.toolCall.input,
          p.mode,
          sessionId,
          {
            modelOverride: p.modelOverride,
            requestToolPermission: (tc) => requestToolPermission(tc, p.mode),
          },
        );
        if (
          output &&
          typeof output === "object" &&
          "modeTransition" in output
        ) {
          options?.onModeChange?.(output.modeTransition as ModeType);
        }
        chatRef.current?.addToolOutput({
          tool: p.toolCall.toolName as keyof ChatTools,
          toolCallId: p.toolCallId,
          output,
        });
      } catch (error) {
        chatRef.current?.addToolOutput({
          tool: p.toolCall.toolName as keyof ChatTools,
          toolCallId: p.toolCallId,
          state: "output-error",
          errorText: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [chatRef, sessionId, options?.onModeChange, requestToolPermission],
  );

  const confirmToolCall = useCallback(
    async (
      toolCallId: string,
      allowed: boolean,
      always: boolean,
      feedback?: string,
    ) => {
      const pending = pendingConfirmations.find(
        (c) => c.toolCallId === toolCallId,
      );
      if (!pending) return;

      // Foreground-subagent permission requests await a promise resolver rather
      // than going through the main-thread addToolOutput path.
      const resolver = permissionResolversRef.current.get(toolCallId);
      if (resolver) {
        permissionResolversRef.current.delete(toolCallId);
        setPendingConfirmations((prev) =>
          prev.filter((c) => c.toolCallId !== toolCallId),
        );
        resolver(allowed);
        return;
      }

      if (always) {
        if (pending.toolCall.toolName === "Bash") {
          const command = pending.toolCall.input?.command;
          if (typeof command === "string" && command.trim()) {
            allowCommand(command);
          }
        } else if (
          pending.toolCall.toolName === "Edit" ||
          pending.toolCall.toolName === "MultiEdit" ||
          pending.toolCall.toolName === "Write"
        ) {
          setAlwaysAllowEdits(true);
        }

        // Execute the current one
        await executeAndOutput(pending);

        // Execute all other pending file edits when the user selects "always".
        if (
          pending.toolCall.toolName === "Edit" ||
          pending.toolCall.toolName === "MultiEdit" ||
          pending.toolCall.toolName === "Write"
        ) {
          const otherEdits = pendingConfirmations.filter(
            (c) =>
              c.toolCallId !== toolCallId &&
              (c.toolCall.toolName === "Edit" ||
                c.toolCall.toolName === "MultiEdit" ||
                c.toolCall.toolName === "Write"),
          );
          for (const other of otherEdits) {
            await executeAndOutput(other);
          }
        }

        setPendingConfirmations((prev) =>
          pending.toolCall.toolName === "Edit" ||
          pending.toolCall.toolName === "MultiEdit" ||
          pending.toolCall.toolName === "Write"
            ? prev.filter(
                (c) =>
                  c.toolCallId !== toolCallId &&
                  c.toolCall.toolName !== "Edit" &&
                  c.toolCall.toolName !== "MultiEdit" &&
                  c.toolCall.toolName !== "Write",
              )
            : prev.filter((c) => c.toolCallId !== toolCallId),
        );
      } else {
        // Just handle the single one
        setPendingConfirmations((prev) =>
          prev.filter((c) => c.toolCallId !== toolCallId),
        );

        if (allowed) {
          await executeAndOutput(pending);
        } else {
          const guidance = feedback?.trim();
          chatRef.current?.addToolOutput({
            tool: pending.toolCall.toolName as keyof ChatTools,
            toolCallId,
            state: "output-error",
            errorText: guidance
              ? `User declined this change. Guidance: ${guidance}`
              : "User rejected the changes",
          });
        }
      }
    },
    [pendingConfirmations, executeAndOutput, setAlwaysAllowEdits],
  );

  const setConfirmationModelOverride = useCallback(
    (toolCallId: string, modelId: SupportedChatModelId | undefined) => {
      setPendingConfirmations((prev) =>
        prev.map((c) =>
          c.toolCallId === toolCallId ? { ...c, modelOverride: modelId } : c,
        ),
      );
    },
    [],
  );

  const answerQuestion = useCallback(
    (
      toolCallId: string,
      answers: Array<{ question: string; answer: string | string[] }>,
    ) => {
      const pending = pendingConfirmations.find(
        (c) => c.toolCallId === toolCallId,
      );
      if (!pending) return;

      setPendingConfirmations((prev) =>
        prev.filter((c) => c.toolCallId !== toolCallId),
      );

      chatRef.current?.addToolOutput({
        tool: "AskUserQuestion" as keyof ChatTools,
        toolCallId,
        output: { answers },
      });
    },
    [pendingConfirmations],
  );
  function estimateTokensForText(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 3.5);
  }

  function estimateTokensForMessages(messages: any[]): number {
    let tokens = 0;
    for (const msg of messages) {
      if (!msg) continue;
      if (typeof msg.content === "string") {
        tokens += estimateTokensForText(msg.content);
      }
      if (Array.isArray(msg.parts)) {
        for (const part of msg.parts) {
          if (!part) continue;
          if (part.type === "text" && typeof part.text === "string") {
            tokens += estimateTokensForText(part.text);
          } else if (
            part.type === "reasoning" &&
            typeof part.text === "string"
          ) {
            tokens += estimateTokensForText(part.text);
          } else if (
            part.type === "dynamic-tool" ||
            part.type.startsWith("tool-")
          ) {
            if (part.input) {
              tokens += estimateTokensForText(JSON.stringify(part.input));
            }
            if (part.output) {
              tokens += estimateTokensForText(JSON.stringify(part.output));
            }
          }
        }
      }
    }
    return tokens;
  }

  const compactHistory = useCallback(
    async (force = false, targetModelId?: SupportedChatModelId) => {
      if (!chatRef.current || isCompactingRef.current) return;
      isCompactingRef.current = true;
      const currentMessages = chatRef.current.messages as Message[];

      const activeModelId =
        targetModelId ||
        currentMessages.findLast((m) => m.metadata?.model)?.metadata?.model ||
        DEFAULT_CHAT_MODEL_ID;
      const modelDef = findSupportedChatModel(activeModelId);
      const limit = modelDef?.contextWindow || 128000;

      if (!force) {
        const lastUsage = currentMessages.findLast((m) => m.metadata?.usage)
          ?.metadata?.usage;

        if (lastUsage && lastUsage.inputTokens) {
          if (lastUsage.inputTokens < 0.8 * limit) {
            isCompactingRef.current = false;
            return;
          }
        } else {
          if (currentMessages.length <= 35) {
            isCompactingRef.current = false;
            return;
          }
        }
      }

      setIsCompacting(true);
      try {
        const activeMode =
          currentMessages.findLast((m) => m.metadata?.mode)?.metadata?.mode ??
          "BUILD";

        try {
          const { compactedMessages } = await compactConversation({
            messages: currentMessages as any[],
            model: activeModelId,
            mode: activeMode,
          });

          if (compactedMessages !== currentMessages) {
            // Preserve any messages that arrived during the async summarize.
            const freshAfterCompact = chatRef.current.messages as Message[];
            const sentIds = new Set(currentMessages.map((m) => m.id));
            const trailing = freshAfterCompact.filter(
              (m) => !sentIds.has(m.id),
            );
            const freshMap = new Map(freshAfterCompact.map((m) => [m.id, m]));

            // Reconstruct last summarized message ID to find compactionId
            const toSummarize = currentMessages.slice(0, -4);
            const lastSummarizedMessage = toSummarize[toSummarize.length - 1];
            const lastMessageId = lastSummarizedMessage?.id || "initial";
            const compactionId = `compaction-${lastMessageId}`;

            const mergedCompacted = (compactedMessages as Message[]).map((m) =>
              m.id !== compactionId && freshMap.has(m.id)
                ? freshMap.get(m.id)!
                : m,
            );

            const finalMerged = [...mergedCompacted, ...trailing];
            chatRef.current.setMessages(finalMerged);
            try {
              replaceSessionMessages(
                getStore(),
                sessionId,
                finalMerged as never,
              );
            } catch (err) {
              console.error("Failed to persist compacted messages: ", err);
            }
            toast.show({
              variant: "success",
              message: "Context compacted.",
            });
            return;
          }
        } catch (err) {
          console.error(
            "Compaction error, falling back to naive compaction:",
            err,
          );
        }

        // --- FALLBACK NAIVE COMPACTION ---
        // 1. Identify the last 5 unique read or modified files
        const accessedFiles: string[] = [];
        const seenFiles = new Set<string>();

        // Traverse messages backwards to collect file access order
        for (let i = currentMessages.length - 1; i >= 0; i--) {
          const msg = currentMessages[i];
          if (!msg || !msg.parts) continue;
          for (let j = msg.parts.length - 1; j >= 0; j--) {
            const part = msg.parts[j] as any;
            if (!part) continue;
            const toolName =
              part.type === "dynamic-tool"
                ? part.toolName
                : part.type?.startsWith("tool-")
                  ? part.type.slice("tool-".length)
                  : null;

            if (
              toolName === "Read" ||
              toolName === "Write" ||
              toolName === "Edit" ||
              toolName === "MultiEdit"
            ) {
              const filePath = part.input?.file_path;
              if (
                filePath &&
                typeof filePath === "string" &&
                !seenFiles.has(filePath)
              ) {
                seenFiles.add(filePath);
                accessedFiles.push(filePath);
              }
            }
          }
        }

        // Merge files from getSessionModifiedFiles to prioritize session edits
        const modifiedFiles = getSessionModifiedFiles(sessionId);
        for (const filePath of modifiedFiles) {
          if (!seenFiles.has(filePath)) {
            seenFiles.add(filePath);
            accessedFiles.unshift(filePath);
          }
        }

        // Preserve the last 5 unique files
        const preservedFiles = new Set(accessedFiles.slice(0, 5));

        // 2. Compact messages — track mutation locally so we don't have to
        // double-stringify the whole transcript afterward just to detect it.
        let wasCompacted = false;
        const compacted = currentMessages.map((msg, index) => {
          // Keep the last 5 messages completely intact
          if (index >= currentMessages.length - 5) {
            return msg;
          }

          // Check if this message contains ONLY read-only search/status tool calls
          if (msg.role === "assistant") {
            const hasText = msg.parts.some(
              (part) => part.type === "text" && part.text.trim().length > 0,
            );

            if (!hasText) {
              const toolNames: string[] = [];
              let onlySearchTools = true;

              for (const part of msg.parts) {
                if (
                  part.type === "dynamic-tool" ||
                  part.type.startsWith("tool-")
                ) {
                  const toolPart = part as any;
                  const toolName =
                    part.type === "dynamic-tool"
                      ? part.toolName
                      : part.type.slice("tool-".length);

                  if (
                    ["Glob", "Grep", "TaskList", "TaskGet"].includes(toolName)
                  ) {
                    toolNames.push(toolName);
                  } else {
                    onlySearchTools = false;
                    break;
                  }
                } else if (part.type !== "reasoning") {
                  onlySearchTools = false;
                  break;
                }
              }

              if (onlySearchTools && toolNames.length > 0) {
                // Collapse this search turn into a single text placeholder part
                wasCompacted = true;
                return {
                  ...msg,
                  parts: [
                    {
                      type: "text" as const,
                      text: `[Search executed: ${toolNames.join(", ")}]`,
                    },
                  ],
                };
              }
            }
          }

          // For other messages, compact individual tool outputs
          const nextParts = msg.parts.map((part) => {
            if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
              const toolPart = part as any;
              const toolName =
                part.type === "dynamic-tool"
                  ? part.toolName
                  : part.type.slice("tool-".length);

              // Preserve file write/edit/read contents for the 5 most recent files
              if (
                (toolName === "Edit" ||
                  toolName === "MultiEdit" ||
                  toolName === "Write" ||
                  toolName === "Read") &&
                toolPart.input?.file_path &&
                preservedFiles.has(toolPart.input.file_path)
              ) {
                return part;
              }

              // Preserve bash outputs for failed commands
              if (
                toolName === "Bash" &&
                toolPart.output?.exitCode !== undefined &&
                toolPart.output?.exitCode !== 0
              ) {
                return part;
              }

              // Clear output of other tools
              if (toolPart.output) {
                const output = toolPart.output;
                if (typeof output === "object") {
                  if (typeof output.content === "string") {
                    const lineCount = output.content.split("\n").length;
                    return {
                      ...part,
                      output: {
                        ...output,
                        content: `[Tool Output Cleared: ${lineCount} lines]`,
                        truncated: true,
                      },
                    };
                  }
                  if (
                    typeof output.stdout === "string" ||
                    typeof output.stderr === "string"
                  ) {
                    const stdoutLines = (output.stdout || "").split(
                      "\n",
                    ).length;
                    const stderrLines = (output.stderr || "").split(
                      "\n",
                    ).length;
                    return {
                      ...part,
                      output: {
                        ...output,
                        stdout: `[Tool Output Cleared: ${stdoutLines} lines]`,
                        stderr: `[Tool Output Cleared: ${stderrLines} lines]`,
                      },
                    };
                  }
                }
              }
            }
            return part;
          });

          const partsChanged =
            nextParts.length !== msg.parts.length ||
            nextParts.some((p, i) => p !== msg.parts[i]);
          if (partsChanged) wasCompacted = true;
          return partsChanged ? { ...msg, parts: nextParts } : msg;
        });

        let finalMessagesForPatch = currentMessages;

        if (wasCompacted) {
          // Update the token usage metadata of the last assistant message in the compacted array
          // to our estimated compacted tokens count, keeping the status bar accurate.
          const estimatedTokens = 1500 + estimateTokensForMessages(compacted);
          const lastAssistantMessage = [...compacted]
            .reverse()
            .find((m) => m.role === "assistant");
          if (lastAssistantMessage) {
            // Zero out metadata.usage on all other compacted messages that are no longer billable
            for (const msg of compacted) {
              if (msg !== lastAssistantMessage && msg.metadata) {
                delete msg.metadata.usage;
              }
            }

            if (!lastAssistantMessage.metadata) {
              lastAssistantMessage.metadata = {};
            }
            lastAssistantMessage.metadata.usage = {
              inputTokens: estimatedTokens,
              outputTokens:
                lastAssistantMessage.metadata.usage?.outputTokens ?? 0,
            } as any;
          }

          // Preserve any messages that arrived during the naive compaction processing
          const freshAfterNaive = chatRef.current.messages as Message[];
          const sentIds = new Set(currentMessages.map((m) => m.id));
          const naiveTrailing = freshAfterNaive.filter(
            (m) => !sentIds.has(m.id),
          );

          const freshMap = new Map(freshAfterNaive.map((m) => [m.id, m]));
          const mergedCompacted = (compacted as Message[]).map((m) => {
            if (freshMap.has(m.id)) {
              return freshMap.get(m.id)!;
            }
            return m;
          });

          const finalMerged = [...mergedCompacted, ...naiveTrailing];
          chatRef.current.setMessages(finalMerged);
          finalMessagesForPatch = finalMerged;
          toast.show({
            variant: "success",
            message: force
              ? "Chat history compacted."
              : "Chat history automatically compacted to save context window.",
          });
        } else if (force) {
          toast.show({
            variant: "info",
            message: "Chat history is already compact.",
          });
        }

        try {
          replaceSessionMessages(
            getStore(),
            sessionId,
            finalMessagesForPatch as never,
          );
        } catch (err) {
          console.error("Failed to persist compacted messages:", err);
        }
      } finally {
        setIsCompacting(false);
        isCompactingRef.current = false;
      }
    },
    [sessionId, toast],
  );

  const clearMessages = useCallback(async () => {
    if (!chatRef.current) return;
    chatRef.current.setMessages([]);
    try {
      replaceSessionMessages(getStore(), sessionId, []);
    } catch (err) {
      console.error("Failed to clear messages:", err);
    }
  }, [sessionId]);

  const rewindMessages = useCallback(
    async (n: number) => {
      if (!chatRef.current) return;
      const current: Message[] = chatRef.current.messages;
      if (current.length === 0 || n <= 0) return;

      // Walk backward collecting (userIdx, assistantIdx) pairs.
      // Resilient to: orphan assistant messages, consecutive same-role messages,
      // imported/reconstructed histories, and any non-alternating structure.
      const pairs: [number, number][] = [];
      let i = current.length - 1;

      while (i >= 0 && pairs.length < n) {
        const msg = current[i];
        if (!msg) {
          i--;
          continue;
        }

        if (msg.role === "assistant") {
          // Search backward for the nearest preceding user message
          let j = i - 1;
          while (j >= 0 && current[j]?.role !== "user") j--;

          if (j >= 0) {
            pairs.push([j, i]);
            i = j - 1;
          } else {
            // Orphan assistant with no preceding user — skip, don't count as a turn
            i--;
          }
        } else {
          // user or other role not followed by an assistant we haven't seen — skip
          i--;
        }
      }

      if (pairs.length === 0) return;

      const removeIndices = new Set(pairs.flatMap(([u, a]) => [u, a]));
      const removedIds = new Set(
        pairs
          .flatMap(([u, a]) => [current[u]?.id, current[a]?.id])
          .filter((id): id is string => !!id),
      );
      const next = current.filter((_, idx) => !removeIndices.has(idx));
      // Preserve any messages that arrived after the snapshot was taken.
      // Id-based dedup (not a positional slice) so we stay correct if the
      // array reference changed via insert/replace, not just append.
      const seenIds = new Set(next.map((m) => m.id));
      const freshAfterRewind = chatRef.current.messages as Message[];
      const rewindTrailing = freshAfterRewind.filter(
        (m) => !seenIds.has(m.id) && !removedIds.has(m.id),
      );
      const merged = [...next, ...rewindTrailing];
      chatRef.current.setMessages(merged);
      try {
        replaceSessionMessages(getStore(), sessionId, merged as never);
      } catch (err) {
        console.error("Failed to persist rewound messages:", err);
      }
    },
    [sessionId],
  );

  const chat = useAiChat<Message>({
    id: sessionId,
    messages: initialMessages,
    transport,
    onToolCall({ toolCall }: { toolCall: any }) {
      const mode = chatRef.current?.messages?.at(-1)?.metadata?.mode ?? "BUILD";
      const loopKey = `${toolCall.toolName}:${JSON.stringify(toolCall.input ?? {})}`;
      const loopCount = (toolLoopCountsRef.current.get(loopKey) ?? 0) + 1;
      toolLoopCountsRef.current.set(loopKey, loopCount);

      if (toolCall.toolName !== "TodoWrite" && loopCount > 8) {
        chatRef.current?.addToolOutput({
          tool: toolCall.toolName as keyof ChatTools,
          toolCallId: toolCall.toolCallId,
          state: "output-error",
          errorText:
            "Loop protection stopped this repeated tool call. Adjust the input or ask the user before retrying.",
        });
        return;
      }

      if (toolCall.toolName === "TodoWrite") {
        const { todos } = toolCall.input as {
          todos: Array<{
            content: string;
            active_form?: string;
            status: "pending" | "in_progress" | "completed";
          }>;
        };
        const items: TodoItem[] = todos.map((t, idx) => ({
          id: String(idx),
          label:
            t.status === "in_progress" && t.active_form
              ? t.active_form
              : t.content,
          status: t.status,
        }));
        todoRef.current(items, true);
        chatRef.current?.addToolOutput({
          tool: "TodoWrite",
          toolCallId: toolCall.toolCallId,
          output: { success: true, itemCount: items.length },
        });
        return;
      }

      if (
        (toolCall.toolName === "Edit" ||
          toolCall.toolName === "MultiEdit" ||
          toolCall.toolName === "Write" ||
          toolCall.toolName === "NotebookEdit") &&
        !alwaysAllowEditsRef.current &&
        mode !== "AUTO"
      ) {
        setPendingConfirmations((prev) => [
          ...prev,
          {
            toolCallId: toolCall.toolCallId,
            toolCall,
            mode,
          },
        ]);
        return;
      }

      if (
        toolCall.toolName === "Bash" &&
        !isCommandAllowed(String(toolCall.input?.command ?? "")) &&
        mode !== "AUTO"
      ) {
        setPendingConfirmations((prev) => [
          ...prev,
          {
            toolCallId: toolCall.toolCallId,
            toolCall,
            mode,
          },
        ]);
        return;
      }

      if (toolCall.toolName === "AskUserQuestion") {
        setPendingConfirmations((prev) => [
          ...prev,
          {
            toolCallId: toolCall.toolCallId,
            toolCall,
            mode,
          },
        ]);
        return;
      }

      // Config writes (value present) require confirmation; reads are auto-allowed.
      if (
        toolCall.toolName === "Config" &&
        toolCall.input?.value !== undefined &&
        mode !== "AUTO"
      ) {
        setPendingConfirmations((prev) => [
          ...prev,
          {
            toolCallId: toolCall.toolCallId,
            toolCall,
            mode,
          },
        ]);
        return;
      }

      if (toolCall.toolName === "Agent" && mode !== "AUTO") {
        setPendingConfirmations((prev) => [
          ...prev,
          { toolCallId: toolCall.toolCallId, toolCall, mode },
        ]);
        return;
      }

      void executeLocalTool(
        toolCall.toolName,
        toolCall.input,
        mode,
        sessionId,
        {
          requestToolPermission: (tc) => requestToolPermission(tc, mode),
        },
      )
        .then((output) => {
          if (
            output &&
            typeof output === "object" &&
            "modeTransition" in output
          ) {
            options?.onModeChange?.(output.modeTransition as ModeType);
          }
          chatRef.current?.addToolOutput({
            tool: toolCall.toolName as keyof ChatTools,
            toolCallId: toolCall.toolCallId,
            output,
          });
        })
        .catch((error) =>
          chatRef.current?.addToolOutput({
            tool: toolCall.toolName as keyof ChatTools,
            toolCallId: toolCall.toolCallId,
            state: "output-error",
            errorText: error instanceof Error ? error.message : String(error),
          }),
        );
    },
    onFinish({ message }) {
      void compactHistory(false, message.metadata?.model as any);
      // Stop hook — fire-and-forget; catch so rejected spawn never becomes unhandled
      setTimeout(() => {
        runStopHooks(sessionId).catch((err) => {
          console.error("Stop hook error:", err);
        });
      }, 0);
    },
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });
  chatRef.current = chat;

  // Freeze the turn clock whenever a confirmation prompt is up, and bank the
  // waited time once it clears.
  useEffect(() => {
    if (pendingConfirmations.length > 0) {
      if (pauseStartRef.current === null) pauseStartRef.current = Date.now();
    } else if (pauseStartRef.current !== null) {
      turnPausedMsRef.current += Date.now() - pauseStartRef.current;
      pauseStartRef.current = null;
    }
  }, [pendingConfirmations.length]);

  // Flush background-agent notifications only when the main chat is idle
  // (priority-"later" semantics): never interrupt an active stream or a pending
  // permission prompt. One notification per idle tick; extras flush on the next.
  useEffect(() => {
    if (chat.status !== "ready") return;
    if (pendingConfirmations.length > 0) return;
    if (!hasNotifications()) return;
    const next = dequeueNotification();
    if (!next) return;
    void chat.sendMessage({ text: next });
  }, [chat.status, pendingConfirmations.length]);

  // Start of the in-flight turn (the latest user prompt), so the working
  // indicator can show one continuous elapsed time across every tool-loop round
  // instead of restarting on each thinking→tool→text transition.
  const activeTurnStartMs = chat.messages.findLast(
    (m) => m.role === "user",
  )?.metadata?.submittedAt;

  return {
    messages: chat.messages,
    status: chat.status,
    error: chat.error,
    activeTurnStartMs,
    getTurnPausedMs,
    pendingConfirmations,
    confirmToolCall,
    setConfirmationModelOverride,
    requestToolPermission,
    answerQuestion,
    compact: () => compactHistory(true),
    clearMessages,
    rewindMessages,
    isCompacting,
    submit: async (params: {
      userText: string;
      mode: ModeType;
      model: SupportedChatModelId;
      reasoningEffort: ReasoningEffortLevel;
      commandProgressMessage?: string;
    }) => {
      // UserPromptSubmit hooks — can block sending; wrap so I/O errors don't drop the message
      let promptHookResult: UserPromptHookResult;
      try {
        promptHookResult = await runUserPromptSubmitHooks(
          params.userText,
          sessionId,
        );
      } catch (err) {
        console.error("UserPromptSubmit hook error:", err);
        promptHookResult = { blocked: false };
      }
      if (promptHookResult.blocked) {
        toast.show({
          variant: "error",
          message: promptHookResult.stopReason ?? "Hook blocked this message",
        });
        return;
      }

      toolLoopCountsRef.current.clear();
      // New turn → reset the pause accumulator so timing starts fresh.
      turnPausedMsRef.current = 0;
      pauseStartRef.current = null;
      await compactHistory(false, params.model);
      return chat.sendMessage({
        text: params.userText,
        metadata: {
          mode: params.mode,
          model: params.model,
          reasoningEffort: params.reasoningEffort,
          submittedAt: Date.now(),
          ...(params.commandProgressMessage
            ? { commandProgressMessage: params.commandProgressMessage }
            : {}),
        },
      });
    },
    abort: chat.stop,
    interrupt: chat.stop,
  };
}
