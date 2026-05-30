import { useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { useDialog } from "../../providers/dialogs";
import { useToast } from "../../providers/toast";

type Props = {
  clearMessages: () => Promise<void>;
};

export function ClearDialogContent({ clearMessages }: Props) {
  const dialog = useDialog();
  const toast = useToast();

  const handleConfirm = useCallback(async () => {
    dialog.close();
    try {
      await clearMessages();
      toast.show({ variant: "success", message: "Conversation cleared." });
    } catch (err) {
      toast.show({
        variant: "error",
        message: `Failed to clear: ${(err as Error).message}`,
      });
    }
  }, [clearMessages, dialog, toast]);

  useKeyboard((key) => {
    if (key.name === "y" || key.name === "Y") {
      key.preventDefault();
      void handleConfirm();
    } else if (key.name === "n" || key.name === "N" || key.name === "escape") {
      key.preventDefault();
      dialog.close();
    }
  });

  return (
    <box flexDirection="column" gap={2} paddingY={1}>
      <text>This will permanently clear all messages in this session.</text>
      <box flexDirection="row" gap={2}>
        <text fg="green">[Y] Confirm</text>
        <text fg="gray">[N / Esc] Cancel</text>
      </box>
    </box>
  );
}
