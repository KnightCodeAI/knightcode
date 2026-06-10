import {
  DEFAULT_CHAT_MODEL_ID,
  type ModeType,
  type ReasoningEffortLevel,
  type SupportedChatModelId,
} from "@repo/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  dequeueNotification,
  hasNotifications,
} from "../lib/tools/Agent/notifications";
import { query } from "../lib/engine/query";
import type { ToolCallRequest, ToolOutcome } from "../lib/engine/events";
import type { Message, PendingConfirmation } from "../lib/engine/messages";
import { repairTranscript } from "../lib/engine/transcript";
import {
  gateToolCall,
  LOOP_PROTECTION_ERROR,
  ToolLoopGuard,
} from "../lib/engine/tool-runner";
import { getOpenRouterApiKey } from "../lib/credentials";
import {
  runStopHooks,
  runUserPromptSubmitHooks,
  type UserPromptHookResult,
} from "../lib/hooks";
import { allowCommand, isCommandAllowed } from "../lib/permissions/permissions";
import { getStore } from "../lib/store/client";
import {
  ensureSession,
  replaceSessionMessages,
} from "../lib/store/conversation";
import { executeLocalTool } from "../lib/tools";
import { useTodo, type TodoItem } from "../providers/todo";
import { useToast } from "../providers/toast";
import { createCompactHistory } from "./compact-history";

export type {
  ChatMessageMetadata,
  Message,
  PendingConfirmation,
} from "../lib/engine/messages";

type Status = "ready" | "submitted" | "streaming" | "error";

type ConfirmDecision = {
  allowed: boolean;
  always: boolean;
  feedback?: string;
  modelOverride?: SupportedChatModelId;
};

const FILE_EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

type SubmitParams = {
  userText: string;
  mode: ModeType;
  model: SupportedChatModelId;
  reasoningEffort: ReasoningEffortLevel;
  commandProgressMessage?: string;
};

export function useQueryEngine(
  sessionId: string,
  initialMessages: Message[],
  options?: { onModeChange?: (mode: ModeType) => void },
) {
  const toast = useToast();
  // Repair on load so resumed sessions render interrupted markers and never
  // replay unresolved tool calls.
  const [messages, setMessages] = useState<Message[]>(() =>
    repairTranscript(initialMessages),
  );
  const [status, setStatus] = useState<Status>("ready");
  const [error, setError] = useState<Error | undefined>(undefined);
  const [pendingConfirmations, setPendingConfirmations] = useState<
    PendingConfirmation[]
  >([]);
  const [isCompacting, setIsCompacting] = useState(false);

  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  // Single write path that syncs the ref synchronously: await continuations
  // (e.g. after compactHistory) read messagesRef before React re-renders, so
  // every write must update the ref immediately, not just on the next render.
  const updateMessages = useCallback(
    (next: Message[] | ((prev: Message[]) => Message[])) => {
      const value =
        typeof next === "function" ? next(messagesRef.current) : next;
      messagesRef.current = value;
      setMessages(value);
    },
    [],
  );
  const pendingConfirmationsRef = useRef(pendingConfirmations);
  pendingConfirmationsRef.current = pendingConfirmations;
  const abortRef = useRef<AbortController | null>(null);
  // Synchronous re-entry guard: abortRef is only assigned after async work in
  // submit, so it alone cannot prevent two concurrent turns.
  const inFlightRef = useRef(false);
  // Submits that arrive mid-turn are queued and drained one at a time once
  // the current turn finishes (the input bar stays enabled while streaming).
  const queuedSubmitsRef = useRef<SubmitParams[]>([]);
  const loopGuardRef = useRef(new ToolLoopGuard());
  const alwaysAllowEditsRef = useRef(false);
  // Resolvers for confirmation prompts keyed by toolCallId. AskUserQuestion
  // resolves with answers via answerQuestion instead.
  const confirmResolversRef = useRef(
    new Map<string, (d: ConfirmDecision) => void>(),
  );
  const questionResolversRef = useRef(
    new Map<string, (answers: { answers: unknown }) => void>(),
  );
  // Foreground-subagent permission requests (boolean resolvers).
  const permissionResolversRef = useRef(
    new Map<string, (allowed: boolean) => void>(),
  );

  // Turn-clock pause while a prompt/question is up (ported from the old
  // useChat hook).
  const turnPausedMsRef = useRef(0);
  const pauseStartRef = useRef<number | null>(null);
  const getTurnPausedMs = useCallback(() => {
    const live =
      pauseStartRef.current !== null ? Date.now() - pauseStartRef.current : 0;
    return turnPausedMsRef.current + live;
  }, []);
  useEffect(() => {
    if (pendingConfirmations.length > 0) {
      if (pauseStartRef.current === null) pauseStartRef.current = Date.now();
    } else if (pauseStartRef.current !== null) {
      turnPausedMsRef.current += Date.now() - pauseStartRef.current;
      pauseStartRef.current = null;
    }
  }, [pendingConfirmations.length]);

  const { setItems: setTodoItems } = useTodo();
  const todoRef = useRef(setTodoItems);
  todoRef.current = setTodoItems;

  const compactHistory = useMemo(
    () =>
      createCompactHistory({
        sessionId,
        getMessages: () => messagesRef.current,
        setMessages: (m) => updateMessages(m),
        setCompacting: setIsCompacting,
        toast: (t) => toast.show(t),
      }),
    [sessionId, toast, updateMessages],
  );

  const persist = useCallback(
    (finalMessages: Message[], modelId: string, reasoningEffort: string) => {
      try {
        const firstUserText = finalMessages
          .find((m) => m.role === "user")
          ?.parts.find(
            (p): p is { type: "text"; text: string } => p.type === "text",
          )?.text;
        ensureSession(getStore(), {
          id: sessionId,
          directory: process.cwd(),
          title: firstUserText?.slice(0, 100) || "Untitled",
          model: modelId,
          reasoningEffort,
        });
        replaceSessionMessages(getStore(), sessionId, finalMessages as never);
      } catch (err) {
        console.error("Failed to persist conversation:", err);
      }
    },
    [sessionId],
  );

  /** Await a user decision for a gated tool call. */
  const requestConfirmation = useCallback(
    (toolCall: ToolCallRequest, mode: ModeType): Promise<ConfirmDecision> =>
      new Promise((resolve) => {
        confirmResolversRef.current.set(toolCall.toolCallId, resolve);
        setPendingConfirmations((prev) => [
          ...prev,
          { toolCallId: toolCall.toolCallId, toolCall, mode },
        ]);
      }),
    [],
  );

  /** Boolean variant used by foreground subagents (ported from the old useChat hook). */
  const requestToolPermission = useCallback(
    (
      toolCall: { toolCallId: string; toolName: string; input: unknown },
      mode: ModeType,
    ): Promise<boolean> =>
      new Promise((resolve) => {
        permissionResolversRef.current.set(toolCall.toolCallId, resolve);
        setPendingConfirmations((prev) => [
          ...prev,
          { toolCallId: toolCall.toolCallId, toolCall, mode },
        ]);
      }),
    [],
  );

  const removePending = useCallback((toolCallId: string) => {
    setPendingConfirmations((prev) =>
      prev.filter((c) => c.toolCallId !== toolCallId),
    );
  }, []);

  /** Engine runTool: gating + execution. Never throws for ordinary failures. */
  const makeRunTool = useCallback(
    (mode: ModeType) =>
      async (toolCall: ToolCallRequest): Promise<ToolOutcome> => {
        if (!loopGuardRef.current.check(toolCall.toolName, toolCall.input)) {
          return { kind: "error", errorText: LOOP_PROTECTION_ERROR };
        }

        const decision = gateToolCall({
          toolName: toolCall.toolName,
          input: toolCall.input,
          mode,
          alwaysAllowEdits: alwaysAllowEditsRef.current,
          isCommandAllowed,
        });

        if (decision === "todo") {
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
          return {
            kind: "output",
            output: { success: true, itemCount: items.length },
          };
        }

        let modelOverride: SupportedChatModelId | undefined;
        if (decision === "confirm") {
          if (toolCall.toolName === "AskUserQuestion") {
            const answers = await new Promise<{ answers: unknown }>(
              (resolve) => {
                questionResolversRef.current.set(toolCall.toolCallId, resolve);
                setPendingConfirmations((prev) => [
                  ...prev,
                  { toolCallId: toolCall.toolCallId, toolCall, mode },
                ]);
              },
            );
            return { kind: "output", output: answers };
          }

          const d = await requestConfirmation(toolCall, mode);
          if (!d.allowed) {
            return {
              kind: "error",
              errorText: d.feedback?.trim()
                ? `User declined this change. Guidance: ${d.feedback.trim()}`
                : "User rejected the changes",
            };
          }
          if (d.always) {
            if (toolCall.toolName === "Bash") {
              const command = (toolCall.input as { command?: string })?.command;
              if (typeof command === "string" && command.trim()) {
                allowCommand(command);
              }
            } else if (FILE_EDIT_TOOLS.has(toolCall.toolName)) {
              alwaysAllowEditsRef.current = true;
            }
          }
          modelOverride = d.modelOverride;
        }

        try {
          const output = await executeLocalTool(
            toolCall.toolName,
            toolCall.input,
            mode,
            sessionId,
            {
              modelOverride,
              requestToolPermission: (tc) => requestToolPermission(tc, mode),
            },
          );
          if (
            output &&
            typeof output === "object" &&
            "modeTransition" in output
          ) {
            options?.onModeChange?.(
              (output as { modeTransition: ModeType }).modeTransition,
            );
          }
          return { kind: "output", output };
        } catch (err) {
          return {
            kind: "error",
            errorText: err instanceof Error ? err.message : String(err),
          };
        }
      },
    [
      sessionId,
      options?.onModeChange,
      requestConfirmation,
      requestToolPermission,
    ],
  );

  const confirmToolCall = useCallback(
    (
      toolCallId: string,
      allowed: boolean,
      always: boolean,
      feedback?: string,
    ) => {
      // Foreground-subagent boolean resolver takes precedence (as today).
      const permResolver = permissionResolversRef.current.get(toolCallId);
      if (permResolver) {
        permissionResolversRef.current.delete(toolCallId);
        removePending(toolCallId);
        permResolver(allowed);
        return;
      }
      const resolver = confirmResolversRef.current.get(toolCallId);
      if (!resolver) return;
      confirmResolversRef.current.delete(toolCallId);
      const pending = pendingConfirmationsRef.current.find(
        (c) => c.toolCallId === toolCallId,
      );
      removePending(toolCallId);
      resolver({
        allowed,
        always,
        feedback,
        modelOverride: pending?.modelOverride,
      });
      // "Always" for a file edit auto-approves the other pending file edits
      // (ported from the old useChat hook). Their resolvers are awaiting too.
      if (
        allowed &&
        always &&
        pending &&
        FILE_EDIT_TOOLS.has(pending.toolCall.toolName)
      ) {
        const pendingNow = pendingConfirmationsRef.current.filter(
          (c) =>
            c.toolCallId !== toolCallId &&
            FILE_EDIT_TOOLS.has(c.toolCall.toolName),
        );
        for (const other of pendingNow) {
          const r = confirmResolversRef.current.get(other.toolCallId);
          if (r) {
            confirmResolversRef.current.delete(other.toolCallId);
            removePending(other.toolCallId);
            r({ allowed: true, always: false });
          }
        }
      }
    },
    [removePending],
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
      removePending(toolCallId);
      const resolver = questionResolversRef.current.get(toolCallId);
      if (!resolver) return;
      questionResolversRef.current.delete(toolCallId);
      resolver({ answers });
    },
    [removePending],
  );

  const submit = useCallback(
    async (params: SubmitParams) => {
      if (inFlightRef.current || abortRef.current) {
        // One turn at a time: queue the submit and run it after this turn.
        queuedSubmitsRef.current.push(params);
        return;
      }
      inFlightRef.current = true;
      try {
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

        loopGuardRef.current.reset();
        turnPausedMsRef.current = 0;
        pauseStartRef.current = null;
        setError(undefined);
        await compactHistory(false, params.model);

        const submittedAt = Date.now();
        const userMessage: Message = {
          id: `user-${crypto.randomUUID()}`,
          role: "user",
          parts: [{ type: "text", text: params.userText }],
          metadata: {
            mode: params.mode,
            model: params.model,
            reasoningEffort: params.reasoningEffort,
            submittedAt,
            ...(params.commandProgressMessage
              ? { commandProgressMessage: params.commandProgressMessage }
              : {}),
          },
        };

        const base = [...messagesRef.current, userMessage];
        updateMessages(base);
        setStatus("submitted");

        const ac = new AbortController();
        abortRef.current = ac;

        const gen = query({
          sessionId,
          cwd: process.cwd(),
          messages: base,
          mode: params.mode,
          modelId: params.model,
          reasoningEffort: params.reasoningEffort,
          getApiKey: getOpenRouterApiKey,
          runTool: makeRunTool(params.mode),
          abortSignal: ac.signal,
          turnStartMs: submittedAt,
          getTurnPausedMs,
        });

        let hadError = false;
        try {
          // Track the latest assistant message locally: React state may not
          // have flushed the final turn_complete upsert when we persist.
          let finalAssistant: Message | null = null;
          const upsertAssistant = (message: Message) => {
            finalAssistant = message;
            updateMessages((prev) => {
              const idx = prev.findIndex((m) => m.id === message.id);
              if (idx === -1) return [...prev, message];
              const next = [...prev];
              next[idx] = message;
              return next;
            });
          };

          while (true) {
            const r = await gen.next();
            if (r.done) {
              if (r.value.reason === "error") {
                hadError = true;
                setError(
                  r.value.error instanceof Error
                    ? r.value.error
                    : new Error(String(r.value.error)),
                );
                setStatus("error");
              }
              break;
            }
            const event = r.value;
            switch (event.type) {
              case "stream_start":
                setStatus("streaming");
                break;
              case "message_update":
              case "turn_complete":
                upsertAssistant(event.message);
                break;
              default:
                break;
            }
          }

          persist(
            finalAssistant ? [...base, finalAssistant] : base,
            params.model,
            params.reasoningEffort,
          );
          void compactHistory(false, params.model);
          setTimeout(() => {
            runStopHooks(sessionId).catch((err) =>
              console.error("Stop hook error:", err),
            );
          }, 0);
        } finally {
          abortRef.current = null;
          if (!hadError) setStatus("ready");
          setPendingConfirmations([]);
          confirmResolversRef.current.clear();
          questionResolversRef.current.clear();
          permissionResolversRef.current.clear();
        }
      } finally {
        inFlightRef.current = false;
        // Drain one queued submit. setTimeout avoids re-entrancy here.
        const queued = queuedSubmitsRef.current.shift();
        if (queued) setTimeout(() => void submitRef.current?.(queued), 0);
      }
    },
    [
      sessionId,
      toast,
      compactHistory,
      makeRunTool,
      getTurnPausedMs,
      persist,
      updateMessages,
    ],
  );
  const submitRef = useRef<typeof submit | null>(null);
  submitRef.current = submit;

  const abort = useCallback(() => {
    abortRef.current?.abort();
    // Aborting should not fire stale queued messages afterwards.
    queuedSubmitsRef.current = [];
    // Unblock any prompt the engine is awaiting so the turn can wind down.
    for (const [id, r] of confirmResolversRef.current) {
      r({ allowed: false, always: false });
      confirmResolversRef.current.delete(id);
    }
    for (const [id, r] of permissionResolversRef.current) {
      r(false);
      permissionResolversRef.current.delete(id);
    }
    for (const [id, r] of questionResolversRef.current) {
      r({ answers: [] });
      questionResolversRef.current.delete(id);
    }
    setPendingConfirmations([]);
  }, []);

  const clearMessages = useCallback(async () => {
    updateMessages([]);
    try {
      replaceSessionMessages(getStore(), sessionId, []);
    } catch (err) {
      console.error("Failed to clear messages:", err);
    }
  }, [sessionId, updateMessages]);

  const rewindMessages = useCallback(
    async (n: number) => {
      const current: Message[] = messagesRef.current;
      if (current.length === 0 || n <= 0) return;

      // Walk backward collecting (userIdx, assistantIdx) pairs. Resilient to
      // orphan assistants, consecutive same-role messages, and imported
      // histories (ported from the old useChat hook).
      const pairs: [number, number][] = [];
      let i = current.length - 1;
      while (i >= 0 && pairs.length < n) {
        const msg = current[i];
        if (!msg) {
          i--;
          continue;
        }
        if (msg.role === "assistant") {
          let j = i - 1;
          while (j >= 0 && current[j]?.role !== "user") j--;
          if (j >= 0) {
            pairs.push([j, i]);
            i = j - 1;
          } else {
            i--;
          }
        } else {
          i--;
        }
      }
      if (pairs.length === 0) return;
      const removeIndices = new Set(pairs.flatMap(([u, a]) => [u, a]));
      const next = current.filter((_, idx) => !removeIndices.has(idx));
      updateMessages(next);
      try {
        replaceSessionMessages(getStore(), sessionId, next as never);
      } catch (err) {
        console.error("Failed to persist rewound messages:", err);
      }
    },
    [sessionId, updateMessages],
  );

  // Background-agent notifications: drain one per idle tick (ported).
  useEffect(() => {
    if (status !== "ready") return;
    if (pendingConfirmations.length > 0) return;
    if (!hasNotifications()) return;
    const next = dequeueNotification();
    if (!next) return;
    const meta = messagesRef.current.findLast(
      (m) => m.metadata?.model,
    )?.metadata;
    void submit({
      userText: next,
      mode: (meta?.mode ?? "BUILD") as ModeType,
      model: (meta?.model ?? DEFAULT_CHAT_MODEL_ID) as SupportedChatModelId,
      reasoningEffort: (meta?.reasoningEffort ??
        "medium") as ReasoningEffortLevel,
    });
  }, [status, pendingConfirmations.length, submit]);

  // Start of the in-flight turn (the latest user prompt), so the working
  // indicator can show one continuous elapsed time across tool-loop rounds.
  const activeTurnStartMs = messages.findLast((m) => m.role === "user")
    ?.metadata?.submittedAt;

  return {
    messages,
    status,
    error,
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
    submit,
    abort,
    interrupt: abort,
  };
}
