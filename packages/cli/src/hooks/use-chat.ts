import { useChat as useAiChat } from "@ai-sdk/react";
import {
  type ModeType,
  type SupportedChatModelId,
  type ToolContracts,
  findSupportedChatModel,
  DEFAULT_CHAT_MODEL_ID,
} from "@knightcode/shared";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type InferUITools,
  type LanguageModelUsage,
  type UIMessage,
} from "ai";
import { useMemo, useState, useCallback, useRef } from "react";
import { apiClient } from "../lib/api-client";
import { getAuth } from "../lib/auth";
import { executeLocalTool, getSessionModifiedFiles } from "../lib/local-tools";
import { loadProjectContextSync } from "../lib/project-context";
import { loadGitContext } from "../lib/git-context";
import { detectProjectStackSync } from "../lib/project-detection";
import { allowCommand, isCommandAllowed } from "../lib/permissions";
import { getExecutionRoot } from "../lib/worktree-tools";
import { useTodo, type TodoItem } from "../providers/todo";
import { useToast } from "../providers/toast";

export type ChatMessageMetadata = {
  mode?: ModeType;
  model?: SupportedChatModelId | string;
  durationMs?: number;
  usage?: LanguageModelUsage;
  isCompaction?: boolean;
  credits?: number;
  originalMessageCount?: number;
  summaryCount?: number;
  preservedCount?: number;
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
};

export function useChat(sessionId: string, initialMessages: Message[]) {
  const toast = useToast();
  const [pendingConfirmations, setPendingConfirmations] = useState<
    PendingConfirmation[]
  >([]);
  const [alwaysAllowEdits, setAlwaysAllowEditsState] = useState(false);
  const alwaysAllowEditsRef = useRef(false);
  const chatRef = useRef<any>(null);
  const toolLoopCountsRef = useRef(new Map<string, number>());
  const [isCompacting, setIsCompacting] = useState(false);
  const { setItems: setTodoItems } = useTodo();
  const todoRef = useRef(setTodoItems);
  todoRef.current = setTodoItems;

  const setAlwaysAllowEdits = useCallback((val: boolean) => {
    setAlwaysAllowEditsState(val);
    alwaysAllowEditsRef.current = val;
  }, []);

  const transport = useMemo(() => {
    return new DefaultChatTransport<Message>({
      api: apiClient.chat.$url().toString(),
      headers() {
        const auth = getAuth();
        return auth ? { Authorization: `Bearer ${auth.token}` } : new Headers();
      },
      prepareSendMessagesRequest({ messages }) {
        const message = messages[messages.length - 1];
        if (!message) throw new Error("No message to send");

        const metadata = messages.findLast(
          (m) => m.metadata?.mode && m.metadata?.model,
        )?.metadata;
        const previousMessage = messages[messages.length - 2];
        const requestMessages =
          message.role === "assistant" && previousMessage?.role === "user"
            ? [previousMessage, message]
            : [message];

        const executionRoot = getExecutionRoot(sessionId);
        const projectCtx = loadProjectContextSync(executionRoot.root);
        const gitCtx = loadGitContext(executionRoot.root);
        const stackCtx = detectProjectStackSync(executionRoot.root);

        return {
          body: {
            id: sessionId,
            messages: requestMessages,
            mode: message.metadata?.mode ?? metadata?.mode,
            model: message.metadata?.model ?? metadata?.model,
            globalInstructions: projectCtx.globalInstructions,
            projectInstructions: projectCtx.projectInstructions,
            gitBranchName: gitCtx.branchName,
            gitStatus: gitCtx.status,
            gitDiffSummary: gitCtx.diffSummary,
            frameworks: stackCtx.frameworks,
            packageManager: stackCtx.packageManager,
            isTypeScript: stackCtx.isTypeScript,
          },
        };
      },
    });
  }, [sessionId]);

  const executeAndOutput = useCallback(
    async (p: PendingConfirmation) => {
      try {
        const output = await executeLocalTool(
          p.toolCall.toolName,
          p.toolCall.input,
          p.mode,
          sessionId,
        );
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
    [chatRef, sessionId],
  );

  const confirmToolCall = useCallback(
    async (toolCallId: string, allowed: boolean, always: boolean) => {
      const pending = pendingConfirmations.find(
        (c) => c.toolCallId === toolCallId,
      );
      if (!pending) return;

      if (always) {
        if (pending.toolCall.toolName === "bash") {
          const command = pending.toolCall.input?.command;
          if (typeof command === "string" && command.trim()) {
            allowCommand(command);
          }
        } else if (
          pending.toolCall.toolName === "editFile" ||
          pending.toolCall.toolName === "writeFile"
        ) {
          setAlwaysAllowEdits(true);
        }

        // Execute the current one
        await executeAndOutput(pending);

        // Execute all other pending file edits when the user selects "always".
        if (
          pending.toolCall.toolName === "editFile" ||
          pending.toolCall.toolName === "writeFile"
        ) {
          const otherEdits = pendingConfirmations.filter(
            (c) =>
              c.toolCallId !== toolCallId &&
              (c.toolCall.toolName === "editFile" ||
                c.toolCall.toolName === "writeFile"),
          );
          for (const other of otherEdits) {
            await executeAndOutput(other);
          }
        }

        setPendingConfirmations((prev) =>
          pending.toolCall.toolName === "editFile" ||
          pending.toolCall.toolName === "writeFile"
            ? prev.filter(
                (c) =>
                  c.toolCallId !== toolCallId &&
                  c.toolCall.toolName !== "editFile" &&
                  c.toolCall.toolName !== "writeFile",
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
          chatRef.current?.addToolOutput({
            tool: pending.toolCall.toolName as keyof ChatTools,
            toolCallId,
            state: "output-error",
            errorText: "User rejected the changes",
          });
        }
      }
    },
    [pendingConfirmations, executeAndOutput, setAlwaysAllowEdits],
  );

  const answerQuestion = useCallback(
    (toolCallId: string, answer: string | string[]) => {
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
        output: { answer },
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
      if (!chatRef.current) return;
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
            return;
          }
        } else {
          if (currentMessages.length <= 35) {
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
          const res = await apiClient.compact.$post({
            json: {
              id: sessionId,
              messages: currentMessages as any[],
              model: activeModelId,
              mode: activeMode,
            },
          });

          if (res.ok) {
            const { compactedMessages, credits } = await res.json();
            chatRef.current.setMessages(compactedMessages);

            toast.show({
              variant: "success",
              message: `Context compacted. Billed: ${credits} credits.`,
            });
            return;
          } else {
            const errText = await res.text();
            console.error(
              "Compaction failed on server, falling back to naive compaction:",
              errText,
            );
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
              toolName === "readFile" ||
              toolName === "writeFile" ||
              toolName === "editFile"
            ) {
              const filePath = part.input?.path;
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

        // 2. Compact messages
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
                    ["glob", "grep", "gitStatus", "gitDiff", "gitLog"].includes(
                      toolName,
                    )
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
                (toolName === "editFile" ||
                  toolName === "writeFile" ||
                  toolName === "readFile") &&
                toolPart.input?.path &&
                preservedFiles.has(toolPart.input.path)
              ) {
                return part;
              }

              // Preserve bash outputs for failed commands
              if (
                toolName === "bash" &&
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

          return {
            ...msg,
            parts: nextParts,
          };
        });

        const wasCompacted =
          JSON.stringify(currentMessages) !== JSON.stringify(compacted);

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

          chatRef.current.setMessages(compacted);
          if (!force) {
            toast.show({
              variant: "success",
              message:
                "Chat history automatically compacted to save context window.",
            });
          }
        }

        try {
          await apiClient.sessions[":id"].$patch({
            param: { id: sessionId },
            json: { messages: compacted as any[] },
          });
        } catch (err) {
          console.error("Failed to sync compacted messages to server:", err);
        }
      } finally {
        setIsCompacting(false);
      }
    },
    [sessionId, toast],
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

      if (toolCall.toolName !== "todoWrite" && loopCount > 8) {
        chatRef.current?.addToolOutput({
          tool: toolCall.toolName as keyof ChatTools,
          toolCallId: toolCall.toolCallId,
          state: "output-error",
          errorText:
            "Loop protection stopped this repeated tool call. Adjust the input or ask the user before retrying.",
        });
        return;
      }

      if (toolCall.toolName === "todoWrite") {
        const { items } = toolCall.input as { items: TodoItem[] };
        todoRef.current(items, true);
        chatRef.current?.addToolOutput({
          tool: "todoWrite",
          toolCallId: toolCall.toolCallId,
          output: { success: true, itemCount: items.length },
        });
        return;
      }

      if (
        (toolCall.toolName === "editFile" ||
          toolCall.toolName === "writeFile") &&
        !alwaysAllowEditsRef.current
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
        toolCall.toolName === "bash" &&
        !isCommandAllowed(String(toolCall.input?.command ?? ""))
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

      void executeLocalTool(toolCall.toolName, toolCall.input, mode, sessionId)
        .then((output) => {
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
    },
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });
  chatRef.current = chat;

  return {
    messages: chat.messages,
    status: chat.status,
    error: chat.error,
    pendingConfirmations,
    confirmToolCall,
    answerQuestion,
    compact: () => compactHistory(true),
    isCompacting,
    submit: async (params: {
      userText: string;
      mode: ModeType;
      model: SupportedChatModelId;
    }) => {
      toolLoopCountsRef.current.clear();
      await compactHistory(false, params.model);
      return chat.sendMessage({
        text: params.userText,
        metadata: {
          mode: params.mode,
          model: params.model,
        },
      });
    },
    abort: chat.stop,
    interrupt: chat.stop,
  };
}
