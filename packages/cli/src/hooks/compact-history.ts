import {
  type SupportedChatModelId,
  findSupportedChatModel,
  DEFAULT_CHAT_MODEL_ID,
} from "@repo/shared";
import { compactConversation } from "../lib/inference/compact-conversation";
import { getStore } from "../lib/store/client";
import { replaceSessionMessages } from "../lib/store/conversation";
import { getSessionModifiedFiles } from "../lib/tools";
import type { Message } from "../lib/engine/messages";

export type CompactHistoryDeps = {
  sessionId: string;
  getMessages: () => Message[];
  setMessages: (messages: Message[]) => void;
  setCompacting: (compacting: boolean) => void;
  toast: (opts: {
    variant: "success" | "info" | "error";
    message: string;
  }) => void;
};

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
        } else if (part.type === "reasoning" && typeof part.text === "string") {
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

export function createCompactHistory(
  deps: CompactHistoryDeps,
): (force?: boolean, targetModelId?: SupportedChatModelId) => Promise<void> {
  const { sessionId } = deps;
  let running = false;
  return async function compactHistory(force = false, targetModelId) {
    if (running) return;
    running = true;
    try {
      const currentMessages = deps.getMessages();

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

      deps.setCompacting(true);
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
          const freshAfterCompact = deps.getMessages();
          const sentIds = new Set(currentMessages.map((m) => m.id));
          const trailing = freshAfterCompact.filter((m) => !sentIds.has(m.id));
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
          deps.setMessages(finalMerged);
          try {
            replaceSessionMessages(getStore(), sessionId, finalMerged as never);
          } catch (err) {
            console.error("Failed to persist compacted messages: ", err);
          }
          deps.toast({
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
                  const stdoutLines = (output.stdout || "").split("\n").length;
                  const stderrLines = (output.stderr || "").split("\n").length;
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
        const freshAfterNaive = deps.getMessages();
        const sentIds = new Set(currentMessages.map((m) => m.id));
        const naiveTrailing = freshAfterNaive.filter((m) => !sentIds.has(m.id));

        const freshMap = new Map(freshAfterNaive.map((m) => [m.id, m]));
        const mergedCompacted = (compacted as Message[]).map((m) => {
          if (freshMap.has(m.id)) {
            return freshMap.get(m.id)!;
          }
          return m;
        });

        const finalMerged = [...mergedCompacted, ...naiveTrailing];
        deps.setMessages(finalMerged);
        finalMessagesForPatch = finalMerged;
        deps.toast({
          variant: "success",
          message: force
            ? "Chat history compacted."
            : "Chat history automatically compacted to save context window.",
        });
      } else if (force) {
        deps.toast({
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
      deps.setCompacting(false);
      running = false;
    }
  };
}
