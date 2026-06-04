import { useCallback, useRef } from "react";
import { type InputRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useDialog } from "../../providers/dialogs";
import { useToast } from "../../providers/toast";
import { useTheme } from "../../providers/theme";
import { getStore } from "../../lib/store/client";
import { renameSession } from "../../lib/store";

type Props = {
  sessionId: string;
};

export function RenameDialogContent({ sessionId }: Props) {
  const dialog = useDialog();
  const toast = useToast();
  const { colors } = useTheme();
  const inputRef = useRef<InputRenderable>(null);

  const handleSubmit = useCallback(async () => {
    const title = inputRef.current?.value?.trim() ?? "";
    if (!title) {
      toast.show({ variant: "error", message: "Session name cannot be empty" });
      return;
    }
    try {
      renameSession(getStore(), sessionId, title);
      toast.show({
        variant: "success",
        message: `Session renamed to "${title}"`,
      });
      dialog.close();
    } catch (err) {
      toast.show({
        variant: "error",
        message: `Failed to rename: ${(err as Error).message}`,
      });
    }
  }, [sessionId, dialog, toast]);

  useKeyboard((key) => {
    if (key.name === "enter" || key.name === "return") {
      key.preventDefault();
      void handleSubmit();
    }
  });

  return (
    <box flexDirection="column" gap={1} width="100%">
      <text>Enter new session name:</text>
      <input ref={inputRef} placeholder="New session name" focused />
      <box flexDirection="row" gap={2} marginTop={1}>
        <text fg={colors.success}>[Enter] Rename</text>
        <text fg={colors.dimSeparator}>[Esc] Cancel</text>
      </box>
    </box>
  );
}
