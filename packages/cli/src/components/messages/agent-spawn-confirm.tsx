import { MODEL_SHORTLIST, type SupportedChatModelId } from "@repo/shared";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import { useKeyboardLayer } from "../../providers/keyboard-layer";
import { useTheme } from "../../providers/theme";
import { PermissionPanel } from "./permission-panel";

type Props = {
  toolCallId: string;
  description: string;
  subagentType: string;
  aliasArg?: string;
  /** Stash the per-spawn override (undefined = use the model's default). */
  onPickModel: (modelId: SupportedChatModelId | undefined) => void;
  onConfirm: (
    toolCallId: string,
    approved: boolean,
    always: boolean,
    feedback?: string,
  ) => void;
};

type Row = { id: SupportedChatModelId | undefined; label: string };

// Row 0 = "use default"; rows 1..N = the curated shortlist.
const ROWS: Row[] = [
  { id: undefined, label: "Default (model-chosen)" },
  ...MODEL_SHORTLIST.map((m) => ({ id: m.id, label: m.label })),
];

/**
 * Subagent launch prompt in the shared PermissionPanel style: title +
 * subtitle, spawn details, model picker (↑/↓), then the numbered Yes/No
 * options every other permission dialog uses (1/y/Enter accepts, 2/n/Esc
 * declines). Owns its keyboard like ToolPermissionRequest.
 */
export function AgentSpawnConfirm({
  toolCallId,
  description,
  subagentType,
  aliasArg,
  onPickModel,
  onConfirm,
}: Props) {
  const { colors } = useTheme();
  const { isTopLayer } = useKeyboardLayer();
  const [index, setIndex] = useState(0);

  useKeyboard((key) => {
    if (!isTopLayer("base")) return;

    if (key.name === "up" || key.name === "down") {
      key.preventDefault();
      const delta = key.name === "up" ? -1 : 1;
      const next = Math.min(ROWS.length - 1, Math.max(0, index + delta));
      if (next === index) return;
      setIndex(next);
      onPickModel(ROWS[next]!.id);
      return;
    }
    if (
      key.name === "return" ||
      key.name === "enter" ||
      key.name === "1" ||
      key.name === "y" ||
      key.name === "Y"
    ) {
      key.preventDefault();
      onConfirm(toolCallId, true, false);
      return;
    }
    if (
      key.name === "escape" ||
      key.name === "2" ||
      key.name === "n" ||
      key.name === "N"
    ) {
      key.preventDefault();
      onConfirm(toolCallId, false, false);
    }
  });

  return (
    <box flexDirection="column" width="100%" marginY={1}>
      <PermissionPanel title="Launch subagent" subtitle={subagentType}>
        <box flexDirection="column" width="100%" marginTop={1}>
          <text>{description}</text>
          {aliasArg ? (
            <text attributes={TextAttributes.DIM}>
              model suggested by assistant: {aliasArg}
            </text>
          ) : null}
        </box>

        <box flexDirection="column" width="100%" marginTop={1}>
          <text attributes={TextAttributes.DIM}>
            Pick the model for this spawn (↑/↓):
          </text>
          {ROWS.map((row, i) => (
            <box key={row.label} flexDirection="row" height={1}>
              <text fg={i === index ? colors.autoMode : undefined}>
                {i === index ? "❯ " : "  "}
              </text>
              <text
                fg={i === index ? colors.autoMode : undefined}
                attributes={i === index ? undefined : TextAttributes.DIM}
              >
                {row.label}
              </text>
            </box>
          ))}
        </box>

        <box flexDirection="column" width="100%" marginTop={1}>
          <text>Do you want to launch this subagent?</text>
          <box flexDirection="column" marginTop={1}>
            <box flexDirection="row" height={1}>
              <text fg={colors.autoMode}>{"❯ "}</text>
              <text fg={colors.autoMode}>1. Yes</text>
            </box>
            <box flexDirection="row" height={1}>
              <text>{"  "}</text>
              <text attributes={TextAttributes.DIM}>2. No (esc)</text>
            </box>
          </box>
        </box>
      </PermissionPanel>
      <box paddingX={1} marginTop={1}>
        <text attributes={TextAttributes.DIM}>
          ↑/↓ to pick a model · Enter to launch · Esc to decline
        </text>
      </box>
    </box>
  );
}
