import { MODEL_SHORTLIST, type SupportedChatModelId } from "@repo/shared";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import { useKeyboardLayer } from "../../providers/keyboard-layer";
import { useTheme } from "../../providers/theme";

type Props = {
  toolCallId: string;
  description: string;
  subagentType: string;
  aliasArg?: string;
  /** Stash the per-spawn override (undefined = use the model's default). */
  onPickModel: (modelId: SupportedChatModelId | undefined) => void;
};

type Row = { id: SupportedChatModelId | undefined; label: string };

// Row 0 = "use default"; rows 1..N = the curated shortlist.
const ROWS: Row[] = [
  { id: undefined, label: "Default (model-chosen)" },
  ...MODEL_SHORTLIST.map((m) => ({ id: m.id, label: m.label })),
];

export function AgentSpawnConfirm({
  toolCallId,
  description,
  subagentType,
  aliasArg,
  onPickModel,
}: Props) {
  const { colors } = useTheme();
  const { isTopLayer } = useKeyboardLayer();
  const [index, setIndex] = useState(0);

  // Only ↑/↓ here; the y/n confirm is handled by the session-level keyboard
  // handler (input is disabled during a pending confirmation, so there's no
  // contention with the input bar). The state update stays pure — the override
  // side effect runs in the event handler, not inside the setState updater.
  useKeyboard((key) => {
    if (!isTopLayer("base")) return;
    if (key.name !== "up" && key.name !== "down") return;
    key.preventDefault();
    const delta = key.name === "up" ? -1 : 1;
    const next = Math.min(ROWS.length - 1, Math.max(0, index + delta));
    if (next === index) return;
    setIndex(next);
    onPickModel(ROWS[next]!.id);
  });

  return (
    <box
      border={["top", "bottom", "left", "right"]}
      borderColor={colors.autoMode}
      padding={1}
      flexDirection="column"
      width="100%"
      marginY={1}
      gap={1}
    >
      <box flexDirection="column">
        <text fg={colors.autoMode} attributes={TextAttributes.BOLD}>
          Launch subagent: {subagentType}
        </text>
        <text>{description}</text>
        {aliasArg ? (
          <text attributes={TextAttributes.DIM}>
            model suggested by assistant: {aliasArg}
          </text>
        ) : null}
      </box>

      <box flexDirection="column">
        <text attributes={TextAttributes.DIM}>
          Pick the model for this spawn (↑/↓):
        </text>
        {ROWS.map((row, i) => (
          <box
            key={row.label}
            flexDirection="row"
            height={1}
            backgroundColor={i === index ? colors.selection : undefined}
          >
            <text fg={i === index ? colors.inverseText : colors.text}>
              {i === index ? "❯ " : "  "}
              {row.label}
            </text>
          </box>
        ))}
      </box>

      <text fg={colors.autoMode} attributes={TextAttributes.BOLD}>
        Accept? [y] Yes [n] No
      </text>
    </box>
  );
}
