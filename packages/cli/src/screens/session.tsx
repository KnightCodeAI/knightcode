import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useLocation, useNavigate } from "react-router";
import { z } from "zod";
import { useKeyboard } from "@opentui/react";
import {
  type ModeType,
  type SupportedChatModelId,
  findSupportedChatModel,
} from "@knightcode/shared";
import type { InferResponseType } from "hono/client";
import { SessionShell } from "../components/session-shell";
import {
  UserMessage,
  BotMessage,
  ErrorMessage,
  CompactionMessage,
} from "../components/messages";
import { useToast } from "../providers/toast";
import { useChat } from "../hooks/use-chat";
import { usePromptConfig } from "../providers/prompt-config";
import type { Message } from "../hooks/use-chat";
import { apiClient } from "../lib/api-client";
import { getErrorMessage } from "../lib/http-errors";
import { useKeyboardLayer } from "../providers/keyboard-layer";
import { useTodo } from "../providers/todo";

type SessionData = InferResponseType<
  (typeof apiClient.sessions)[":id"]["$get"],
  200
>;

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

function ChatMessage({
  msg,
  pendingConfirmations,
  answerQuestion,
}: {
  msg: Message;
  pendingConfirmations: any[];
  answerQuestion: (toolCallId: string, answer: string | string[]) => void;
}) {
  const text = msg.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");

  if (msg.metadata?.isCompaction) {
    return (
      <CompactionMessage
        model={msg.metadata.model || "unknown"}
        credits={msg.metadata.credits ?? 0}
        originalMessageCount={msg.metadata.originalMessageCount ?? 0}
        summary={text}
        summaryCount={msg.metadata.summaryCount}
        preservedCount={msg.metadata.preservedCount}
      />
    );
  }

  if (msg.role === "user") {
    return <UserMessage message={text} mode={msg.metadata?.mode ?? "BUILD"} />;
  }

  return (
    <BotMessage
      parts={msg.parts}
      model={msg.metadata?.model ?? "unknown"}
      mode={msg.metadata?.mode ?? "BUILD"}
      durationMs={msg.metadata?.durationMs}
      streaming={false}
      pendingConfirmations={pendingConfirmations}
      answerQuestion={answerQuestion}
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
  const { mode, model } = usePromptConfig();
  const { isTopLayer } = useKeyboardLayer();
  const {
    messages,
    status,
    submit,
    abort,
    interrupt,
    error,
    pendingConfirmations,
    confirmToolCall,
    answerQuestion,
    compact,
    isCompacting,
  } = useChat(session.id, initialMessages);
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

          if (toolName === "todoWrite" && (part as any).input?.items) {
            foundItems = (part as any).input.items;
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

  // Let the user cancel a reply even before the first streamed chunk arrives.
  useKeyboard((key) => {
    if (key.ctrl && key.name === "t") {
      key.preventDefault();
      toggleExpanded();
      return;
    }

    if (pending && pending.toolCall.toolName !== "AskUserQuestion") {
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
    });
  }, [initialPrompt, submit]);

  return (
    <SessionShell
      onSubmit={(text) => submit({ userText: text, mode, model })}
      loading={status === "submitted" || status === "streaming" || isCompacting}
      isCompacting={isCompacting}
      interruptible={
        (status === "submitted" || status === "streaming") && !isCompacting
      }
      inputDisabled={pendingConfirmations.length > 0 || isCompacting}
      compact={compact}
      tokenStats={tokenStats}
    >
      {messages.map((msg) => (
        <ChatMessage
          key={msg.id}
          msg={msg}
          pendingConfirmations={pendingConfirmations}
          answerQuestion={answerQuestion}
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
    // Skip fetch if session was passed via location state
    if (prefetched?.session) return;

    setSession(null);

    if (!id) return;

    let ignore = false;
    const fetchSession = async () => {
      try {
        const res = await apiClient.sessions[":id"].$get({
          param: { id },
        });
        if (ignore) return;
        if (!res.ok) throw new Error(await getErrorMessage(res));
        const resolved = await res.json();
        setSession(resolved);
      } catch (err) {
        if (ignore) return;
        toast.show({
          variant: "error",
          message:
            err instanceof Error ? err.message : "Failed to load session",
        });
        navigate("/", { replace: true });
      }
    };

    fetchSession();
    return () => {
      ignore = true;
    };
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
