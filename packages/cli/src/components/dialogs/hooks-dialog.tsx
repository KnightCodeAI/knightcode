import { useCallback, useRef, useState } from "react";
import { type InputRenderable, TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useToast } from "../../providers/toast";
import {
  loadHooks,
  addHook,
  removeHook,
  type HookEvent,
} from "../../lib/hooks";

const HOOK_EVENTS: HookEvent[] = [
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "UserPromptSubmit",
  "Stop",
];

const EVENT_DESC: Record<HookEvent, string> = {
  PreToolUse: "before tool — can block",
  PostToolUse: "after tool succeeds",
  PostToolUseFailure: "after tool fails",
  UserPromptSubmit: "before message — can block",
  Stop: "when AI finishes",
};

type FlatHook = {
  matcherIdx: number;
  hookIdx: number;
  matcher: string;
  command: string;
};

function getEventHooks(
  config: ReturnType<typeof loadHooks>,
  event: HookEvent,
): FlatHook[] {
  const result: FlatHook[] = [];
  (config[event] ?? []).forEach((group, mIdx) => {
    group.hooks.forEach((hook, hIdx) => {
      result.push({
        matcherIdx: mIdx,
        hookIdx: hIdx,
        matcher: group.matcher ?? "*",
        command: hook.command,
      });
    });
  });
  return result;
}

export function HooksDialogContent() {
  const toast = useToast();
  const matcherRef = useRef<InputRenderable>(null);
  const commandRef = useRef<InputRenderable>(null);
  const [hooks, setHooks] = useState(() => loadHooks());
  const [eventIdx, setEventIdx] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [inputFocus, setInputFocus] = useState<"matcher" | "command">(
    "matcher",
  );

  const activeEvent = HOOK_EVENTS[eventIdx]!;
  const eventHooks = getEventHooks(hooks, activeEvent);
  const reload = useCallback(() => {
    setHooks(loadHooks());
    setSelectedIdx(null);
  }, []);

  const handleAdd = useCallback(() => {
    const matcher = matcherRef.current?.value?.trim() || "*";
    const command = commandRef.current?.value?.trim() ?? "";
    if (!command) {
      toast.show({ variant: "error", message: "Command is required" });
      return;
    }
    addHook(activeEvent, matcher, command);
    if (matcherRef.current) matcherRef.current.value = "";
    if (commandRef.current) commandRef.current.value = "";
    reload();
    toast.show({ variant: "success", message: "Hook added" });
  }, [activeEvent, toast, reload]);

  const handleDelete = useCallback(
    (item: FlatHook) => {
      removeHook(activeEvent, item.matcherIdx, item.hookIdx);
      reload();
    },
    [activeEvent, reload],
  );

  useKeyboard((key) => {
    // Navigate events with left/right when no hook selected
    if (selectedIdx === null) {
      if (key.name === "left") {
        key.preventDefault();
        setEventIdx((i) => (i - 1 + HOOK_EVENTS.length) % HOOK_EVENTS.length);
        return;
      }
      if (key.name === "right") {
        key.preventDefault();
        setEventIdx((i) => (i + 1) % HOOK_EVENTS.length);
        return;
      }
      if (key.name === "tab") {
        key.preventDefault();
        setInputFocus((f) => (f === "matcher" ? "command" : "matcher"));
        return;
      }
      if ((key.name === "enter" || key.name === "return") && !key.shift) {
        key.preventDefault();
        handleAdd();
        return;
      }
      if (key.name === "up" && eventHooks.length > 0) {
        key.preventDefault();
        setSelectedIdx(eventHooks.length - 1);
        return;
      }
    }

    // Hook list navigation
    if (selectedIdx !== null) {
      if (key.name === "up") {
        key.preventDefault();
        setSelectedIdx((i) => (i !== null && i > 0 ? i - 1 : i));
        return;
      }
      if (key.name === "down") {
        key.preventDefault();
        setSelectedIdx((i) =>
          i !== null && i < eventHooks.length - 1 ? i + 1 : i,
        );
        return;
      }
      if (key.name === "d" || key.name === "delete") {
        key.preventDefault();
        const item = eventHooks[selectedIdx];
        if (item) handleDelete(item);
        return;
      }
      if (key.name === "escape") {
        key.preventDefault();
        setSelectedIdx(null);
        return;
      }
    }
  });

  return (
    <box flexDirection="column" gap={1} width="100%">
      {/* Event header — single line */}
      <box flexDirection="row" gap={1} alignItems="center">
        <text fg="gray">◀</text>
        <text fg="cyan" attributes={TextAttributes.BOLD}>
          {activeEvent}
        </text>
        <text fg="gray">▶</text>
        <text fg="gray" attributes={TextAttributes.DIM}>
          {" "}
          {EVENT_DESC[activeEvent]}
        </text>
      </box>

      {/* Hook list */}
      <box flexDirection="column">
        {eventHooks.length === 0 ? (
          <text fg="gray" attributes={TextAttributes.DIM}>
            {" "}
            no hooks
          </text>
        ) : (
          eventHooks.map((item, idx) => {
            const sel = selectedIdx === idx;
            return (
              <box
                key={`${item.matcherIdx}-${item.hookIdx}`}
                flexDirection="row"
                gap={2}
              >
                <text fg={sel ? "yellow" : "gray"}>{sel ? "▶" : " "}</text>
                <box width={12} flexShrink={0}>
                  <text fg={sel ? "yellow" : "cyan"}>{item.matcher}</text>
                </box>
                <text
                  fg={sel ? "white" : undefined}
                  attributes={sel ? TextAttributes.BOLD : TextAttributes.DIM}
                >
                  {item.command}
                </text>
              </box>
            );
          })
        )}
      </box>

      {/* Divider */}
      <text fg="gray" attributes={TextAttributes.DIM}>
        ──────────────────────────
      </text>

      {/* Add form — compact */}
      <box flexDirection="column" gap={0}>
        <input
          ref={matcherRef}
          placeholder="matcher  (* = all tools)"
          focused={selectedIdx === null && inputFocus === "matcher"}
        />
        <input
          ref={commandRef}
          placeholder="command  (JSON piped to stdin)"
          focused={selectedIdx === null && inputFocus === "command"}
        />
      </box>

      {/* Footer */}
      {selectedIdx === null ? (
        <text attributes={TextAttributes.DIM} fg="gray">
          [Enter] add · [Tab] field · [←/→] event · [↑] select · [Esc] close
        </text>
      ) : (
        <text attributes={TextAttributes.DIM} fg="gray">
          [d] delete · [↑/↓] navigate · [Esc] back
        </text>
      )}
    </box>
  );
}
