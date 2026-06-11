import { TextAttributes } from "@opentui/core";
import type { ModeType } from "@repo/shared";
import type { Message } from "../../lib/engine/messages";
import { useTheme } from "../../providers/theme";
import { BotMessage } from "./bot-message";

type Props = {
  parts: Message["parts"];
  model: string;
  mode: ModeType;
  /** Accepted for call-site compatibility; intentionally not rendered. */
  durationMs?: number;
  pendingConfirmations?: any[];
  answerQuestion?: (
    toolCallId: string,
    answers: Array<{ question: string; answer: string | string[] }>,
  ) => void;
};

/**
 * Renders a partial/interrupted assistant response.
 * Shown when the user pressed Escape mid-stream. The partial content is
 * persisted in the database with isInterrupted: true so it survives reloads.
 */
export function InterruptedMessage({
  parts,
  model,
  mode,
  pendingConfirmations,
  answerQuestion,
}: Props) {
  const { colors } = useTheme();
  return (
    <box width="100%" flexDirection="column">
      {/* durationMs intentionally withheld: it gates BotMessage's whimsical
          "Crunched for Xs" completion line, which reads wrong on an
          interrupted turn — the marker below already states the outcome. */}
      <BotMessage
        parts={parts}
        model={model}
        mode={mode}
        streaming={false}
        pendingConfirmations={pendingConfirmations}
        answerQuestion={answerQuestion}
      />
      {/* After the partial content, like claude-code's InterruptedByUser. */}
      <box paddingX={3} paddingTop={1} paddingBottom={0}>
        <text fg={colors.warning} attributes={TextAttributes.DIM}>
          Interrupted, what can I do for you instead?
        </text>
      </box>
    </box>
  );
}
