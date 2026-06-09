import { TextAttributes } from "@opentui/core";
import type { ModeType } from "@repo/shared";
import type { Message } from "../../hooks/use-chat";
import { useTheme } from "../../providers/theme";
import { BotMessage } from "./bot-message";

type Props = {
  parts: Message["parts"];
  model: string;
  mode: ModeType;
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
  durationMs,
  pendingConfirmations,
  answerQuestion,
}: Props) {
  const { colors } = useTheme();
  return (
    <box width="100%" flexDirection="column">
      <box paddingX={3} paddingTop={1} paddingBottom={0}>
        <text fg={colors.warning} attributes={TextAttributes.DIM}>
          ⚠ interrupted
        </text>
      </box>
      <BotMessage
        parts={parts}
        model={model}
        mode={mode}
        durationMs={durationMs}
        streaming={false}
        pendingConfirmations={pendingConfirmations}
        answerQuestion={answerQuestion}
      />
    </box>
  );
}
