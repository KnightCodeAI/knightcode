import { useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useDialog } from "../../providers/dialogs";
import { useToast } from "../../providers/toast";

type Props = {
  rewindMessages: (n: number) => Promise<void>;
  maxTurns: number;
};

export function RewindDialogContent({ rewindMessages, maxTurns }: Props) {
  const { close } = useDialog();
  const toast = useToast();
  const [turns, setTurns] = useState(1);

  useKeyboard((key) => {
    if (key.name === "escape") {
      key.preventDefault();
      close();
    } else if (key.name === "up") {
      key.preventDefault();
      setTurns((n) => Math.min(n + 1, maxTurns));
    } else if (key.name === "down") {
      key.preventDefault();
      setTurns((n) => Math.max(n - 1, 1));
    } else if (key.name === "enter" || key.name === "return") {
      key.preventDefault();
      close();
      rewindMessages(turns)
        .then(() => {
          toast.show({
            variant: "success",
            message: `Rewound ${turns} turn${turns !== 1 ? "s" : ""}`,
          });
        })
        .catch((err: Error) => {
          toast.show({ variant: "error", message: err.message });
        });
    }
  });

  return (
    <box flexDirection="column" gap={1} width="100%">
      <text attributes={TextAttributes.BOLD}>Rewind conversation</text>
      <text attributes={TextAttributes.DIM}>
        Remove the last N turns (user + assistant pairs) from the conversation.
      </text>
      <box flexDirection="row" gap={2} marginTop={1} alignItems="center">
        <text attributes={TextAttributes.DIM}>Turns to remove:</text>
        <text fg="cyan" attributes={TextAttributes.BOLD}>
          {turns}
        </text>
        <text attributes={TextAttributes.DIM}>(max {maxTurns})</text>
      </box>
      <box flexDirection="row" gap={2} marginTop={1}>
        <text fg="gray">[↑/↓] Adjust</text>
        <text fg="green">[Enter] Confirm</text>
        <text fg="gray">[Esc] Cancel</text>
      </box>
    </box>
  );
}
