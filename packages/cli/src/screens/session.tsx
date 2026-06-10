import { useState, useEffect, useMemo, useRef } from "react";
import { TextAttributes } from "@opentui/core";
import { useParams, useLocation, useNavigate } from "react-router";
import { z } from "zod";
import { useKeyboard } from "@opentui/react";
import { copyToClipboard } from "../lib/clipboard";
import {
  type ModeType,
  type SupportedChatModelId,
  findSupportedChatModel,
} from "@repo/shared";
import { SessionShell } from "../components/session-shell";
import {
  UserMessage,
  BotMessage,
  ErrorMessage,
  CompactionMessage,
  InterruptedMessage,
} from "../components/messages";
import { useToast } from "../providers/toast";
import { useTheme } from "../providers/theme";
import { useQueryEngine } from "../hooks/use-query-engine";
import { usePromptConfig } from "../providers/prompt-config";
import type { Message } from "../lib/engine/messages";
import { getStore } from "../lib/store/client";
import { getSession, type SessionRow } from "../lib/store";
import { loadConversation } from "../lib/store/conversation";
import { useKeyboardLayer } from "../providers/keyboard-layer";
import { useTodo } from "../providers/todo";

type SessionData = SessionRow & { messages: Message[] };

const sessionLocationSchema = z.object({
  session: z.custom<SessionData>(
    (val) => val != null && typeof val === "object" && "id" in val,
  ),
  initialPrompt: z
    .object({
      message: z.string(),
      mode: z.custom<ModeType>(),
      model: z.custom<SupportedChatModelId>(),
    })
    .optional(),
});

function CommandProgressMessage({ message }: { message: string }) {
  const { colors } = useTheme();
  return (
    <box flexDirection="row" gap={1} paddingX={3} paddingY={1}>
      <spinner name="dots14" color={colors.primary} />
      <text attributes={TextAttributes.DIM}>{message}</text>
    </box>
  );
}

function ChatMessage({
  msg,
  streaming,
  pendingConfirmations,
  answerQuestion,
  setConfirmationModelOverride,
  confirmToolCall,
  activePendingId,
}: {
  msg: Message;
  streaming: boolean;
  pendingConfirmations: any[];
  answerQuestion: (
    toolCallId: string,
    answers: Array<{ question: string; answer: string | string[] }>,
  ) => void;
  setConfirmationModelOverride: (
    toolCallId: string,
    modelId: SupportedChatModelId | undefined,
  ) => void;
  confirmToolCall: (
    toolCallId: string,
    approved: boolean,
    always: boolean,
    feedback?: string,
  ) => void;
  activePendingId?: string;
}) {
  const text = msg.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");

  if (msg.metadata?.isInterrupted) {
    return (
      <InterruptedMessage
        parts={msg.parts}
        model={msg.metadata?.model ?? "unknown"}
        mode={msg.metadata?.mode ?? "BUILD"}
        durationMs={msg.metadata?.durationMs}
        pendingConfirmations={pendingConfirmations}
        answerQuestion={answerQuestion}
      />
    );
  }

  if (msg.metadata?.isCompaction) {
    return (
      <CompactionMessage
        model={msg.metadata.model || "unknown"}
        originalMessageCount={msg.metadata.originalMessageCount ?? 0}
        summary={text}
        summaryCount={msg.metadata.summaryCount}
        preservedCount={msg.metadata.preservedCount}
      />
    );
  }

  if (msg.role === "user") {
    if (msg.metadata?.commandProgressMessage) {
      return (
        <CommandProgressMessage message={msg.metadata.commandProgressMessage} />
      );
    }
    return <UserMessage message={text} />;
  }

  return (
    <BotMessage
      parts={msg.parts}
      model={msg.metadata?.model ?? "unknown"}
      mode={msg.metadata?.mode ?? "BUILD"}
      durationMs={msg.metadata?.durationMs}
      streaming={streaming}
      pendingConfirmations={pendingConfirmations}
      answerQuestion={answerQuestion}
      setConfirmationModelOverride={setConfirmationModelOverride}
      confirmToolCall={confirmToolCall}
      activePendingId={activePendingId}
    />
  );
}

function SessionChat({
  session,
  initialPrompt,
}: {
  session: SessionData;
  initialPrompt?: {
    message: string;
    mode: ModeType;
    model: SupportedChatModelId;
  };
}) {
  const [initialMessages] = useState(
    () => session.messages as unknown as Message[],
  );
  const { mode, model, reasoningEffort, setMode } = usePromptConfig();
  const { isTopLayer } = useKeyboardLayer();
  const toast = useToast();

  const {
    messages,
    status,
    queuedMessages,
    submit,
    abort,
    interrupt,
    error,
    activeTurnStartMs,
    getTurnPausedMs,
    pendingConfirmations,
    confirmToolCall,
    setConfirmationModelOverride,
    answerQuestion,
    compact,
    clearMessages,
    rewindMessages,
    isCompacting,
  } = useQueryEngine(session.id, initialMessages, { onModeChange: setMode });
  const { setItems, clearAll, toggleExpanded } = useTodo();

  useEffect(() => {
    let foundItems: any[] | null = null;
    for (let i = initialMessages.length - 1; i >= 0; i--) {
      const msg = initialMessages[i];
      if (msg && msg.role === "assistant" && msg.parts) {
        for (let j = msg.parts.length - 1; j >= 0; j--) {
          const part = msg.parts[j];
          if (!part) continue;
          const toolName =
            part.type === "dynamic-tool"
              ? (part as any).toolName
              : part.type.startsWith("tool-")
                ? part.type.slice("tool-".length)
                : null;

          if (toolName === "TodoWrite" && (part as any).input?.todos) {
            const todos = (part as any).input.todos as Array<{
              content: string;
              active_form?: string;
              status: "pending" | "in_progress" | "completed";
            }>;
            foundItems = todos.map((t, idx) => ({
              id: String(idx),
              label:
                t.status === "in_progress" && t.active_form
                  ? t.active_form
                  : t.content,
              status: t.status,
            }));
            break;
          }
        }
      }
      if (foundItems) break;
    }

    if (foundItems) {
      setItems(foundItems);
    } else {
      clearAll();
    }

    return () => {
      clearAll();
    };
  }, [initialMessages, setItems, clearAll]);

  const hasSubmittedInitialPromptRef = useRef(false);

  const usageDependency = useMemo(() => {
    return messages
      .filter((m) => m.metadata?.usage)
      .map(
        (m) =>
          `${m.id}-${m.metadata?.usage?.inputTokens}-${m.metadata?.usage?.outputTokens}`,
      )
      .join(",");
  }, [messages]);

  const usageSummary = useMemo(() => {
    return messages
      .filter((m) => m.metadata?.usage)
      .map((m) => ({
        input: m.metadata?.usage?.inputTokens ?? 0,
        output: m.metadata?.usage?.outputTokens ?? 0,
        model: m.metadata?.model || model,
      }));
  }, [usageDependency, model]);

  const tokenStats = useMemo(() => {
    let inputTokens = 0;
    let outputTokens = 0;
    let totalCost = 0;
    let lastInputTokens: number | undefined = undefined;

    for (const item of usageSummary) {
      const input = item.input;
      const output = item.output;
      inputTokens += input;
      outputTokens += output;
      lastInputTokens = input;

      const modelDef = findSupportedChatModel(item.model);
      if (modelDef?.pricing) {
        const inputCost =
          (input / 1_000_000) * modelDef.pricing.inputUsdPerMillionTokens;
        const outputCost =
          (output / 1_000_000) * modelDef.pricing.outputUsdPerMillionTokens;
        totalCost += inputCost + outputCost;
      }
    }

    return { inputTokens, outputTokens, totalCost, lastInputTokens };
  }, [usageSummary]);

  // Stop the pending reply when the user leaves this session.
  useEffect(() => {
    return () => {
      void abort();
    };
  }, [abort]);

  const pending = pendingConfirmations[0];

  // Live signal for the working row: how much the assistant has produced this
  // turn (drives the token counter + stall detection) and whether a tool is
  // currently executing (drives the tool-use flash + suppresses the stall red).
  const lastMessage = messages[messages.length - 1];
  let responseChars = 0;
  let toolActive = false;
  if (lastMessage?.role === "assistant") {
    for (const part of lastMessage.parts) {
      if (part.type === "text" || part.type === "reasoning") {
        responseChars += (part as { text?: string }).text?.length ?? 0;
      } else if (
        part.type === "dynamic-tool" ||
        part.type.startsWith("tool-")
      ) {
        // Any tool part still lacking output means a tool is mid-flight — keep
        // it true regardless of position so the spinner never reddens mid-tool.
        const st = (part as { state?: string }).state;
        if (st === "input-streaming" || st === "input-available") {
          toolActive = true;
        }
      }
    }
  }

  // Let the user cancel a reply even before the first streamed chunk arrives.
  useKeyboard((key) => {
    if (key.ctrl && key.name === "t") {
      key.preventDefault();
      toggleExpanded();
      return;
    }

    // Edit/Write/Bash own their keyboard via ToolPermissionRequest (it has a
    // reject-feedback text input, so the global y/n/a shortcuts would collide
    // with typing). Other confirmations (Agent/Config/…) still use these keys.
    const dialogOwnsKeys =
      !!pending &&
      (pending.toolCall.toolName === "Edit" ||
        pending.toolCall.toolName === "Write" ||
        pending.toolCall.toolName === "Bash");

    if (
      pending &&
      pending.toolCall.toolName !== "AskUserQuestion" &&
      !dialogOwnsKeys &&
      isTopLayer("base")
    ) {
      if (key.name === "y" || key.name === "Y") {
        key.preventDefault();
        confirmToolCall(pending.toolCallId, true, false);
      } else if (key.name === "n" || key.name === "N") {
        key.preventDefault();
        confirmToolCall(pending.toolCallId, false, false);
      } else if (key.name === "a" || key.name === "A") {
        key.preventDefault();
        confirmToolCall(pending.toolCallId, true, true);
      }
    } else if (
      key.name === "escape" &&
      isTopLayer("base") &&
      status === "streaming"
    ) {
      key.preventDefault();
      interrupt();
    }
  });

  useEffect(() => {
    if (!initialPrompt || hasSubmittedInitialPromptRef.current) return;
    hasSubmittedInitialPromptRef.current = true;
    void submit({
      userText: initialPrompt.message,
      mode: initialPrompt.mode,
      model: initialPrompt.model,
      reasoningEffort,
    });
  }, [initialPrompt, submit, reasoningEffort]);

  return (
    <SessionShell
      onSubmit={(text) => submit({ userText: text, mode, model, reasoningEffort })}
      loading={status === "submitted" || status === "streaming" || isCompacting}
      turnStartMs={activeTurnStartMs}
      getPausedMs={getTurnPausedMs}
      responseChars={responseChars}
      toolActive={toolActive}
      isCompacting={isCompacting}
      interruptible={
        (status === "submitted" || status === "streaming") && !isCompacting
      }
      inputDisabled={pendingConfirmations.length > 0 || isCompacting}
      compact={compact}
      clearMessages={clearMessages}
      rewindMessages={rewindMessages}
      messages={messages}
      queuedMessages={queuedMessages}
      tokenStats={tokenStats}
      submitMessage={(text) =>
        submit({ userText: text, mode, model, reasoningEffort })
      }
      submitCommand={(text, progressMessage) =>
        submit({
          userText: text,
          mode,
          model,
          reasoningEffort,
          commandProgressMessage: progressMessage,
        })
      }
    >
      {messages.map((msg, idx) => (
        <ChatMessage
          key={msg.id}
          msg={msg}
          // The last message is still "live" until the turn settles to ready —
          // gate the "Cooked for…" line on that so it never shows mid-turn.
          streaming={
            idx === messages.length - 1 &&
            (status === "streaming" || status === "submitted")
          }
          pendingConfirmations={pendingConfirmations}
          answerQuestion={answerQuestion}
          setConfirmationModelOverride={setConfirmationModelOverride}
          confirmToolCall={confirmToolCall}
          activePendingId={pending?.toolCallId}
        />
      ))}
      {error && <ErrorMessage message={error.message} />}
    </SessionShell>
  );
}

export function Session() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();

  const prefetched = useMemo(() => {
    const parsed = sessionLocationSchema.safeParse(location.state);
    return parsed.success ? parsed.data : null;
  }, [location.state]);

  const [session, setSession] = useState<SessionData | null>(
    prefetched?.session ?? null,
  );

  const { setReasoningEffort } = usePromptConfig();

  useEffect(() => {
    if (session) {
      setReasoningEffort((session.reasoningEffort as any) || "medium");
    }
  }, [session, setReasoningEffort]);

  useEffect(() => {
    // Skip load if session was passed via location state
    if (prefetched?.session) return;

    setSession(null);

    if (!id) return;

    try {
      const db = getStore();
      const row = getSession(db, id);
      if (!row) throw new Error("Session not found");
      // Stored rows hold UIMessage-shaped JSON (we wrote them from Message
      // objects); narrow each field explicitly rather than an opaque cast.
      const messages: Message[] = loadConversation(db, id).map((m) => ({
        id: m.id,
        role: m.role as Message["role"],
        parts: (m.parts ?? []) as Message["parts"],
        metadata: (m.metadata ?? undefined) as Message["metadata"],
      }));
      setSession({ ...row, messages });
    } catch (err) {
      toast.show({
        variant: "error",
        message: err instanceof Error ? err.message : "Failed to load session",
      });
      navigate("/", { replace: true });
    }
  }, [id, prefetched, toast, navigate]);

  if (!session) {
    return <SessionShell onSubmit={() => {}} inputDisabled loading />;
  }

  return (
    <SessionChat
      key={session.id}
      session={session}
      initialPrompt={prefetched?.initialPrompt}
    />
  );
}
