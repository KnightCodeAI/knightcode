import { useCallback, useRef } from "react";
import { type InputRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useDialog } from "../../providers/dialogs";
import { useToast } from "../../providers/toast";
import { useTheme } from "../../providers/theme";
import { join } from "path";
import { appendFileSync, existsSync, writeFileSync } from "fs";

export function MemoryDialogContent() {
  const dialog = useDialog();
  const toast = useToast();
  const { colors } = useTheme();
  const inputRef = useRef<InputRenderable>(null);

  const handleSubmit = useCallback(() => {
    const text = inputRef.current?.value?.trim() ?? "";
    if (!text) {
      toast.show({ variant: "error", message: "Memory text cannot be empty" });
      return;
    }

    const localDir = process.cwd();
    const localPath = join(localDir, "KNIGHTCODE.md");

    try {
      // Ensure file exists
      if (!existsSync(localPath)) {
        writeFileSync(
          localPath,
          "# Project Memory: KnightCode Guidelines\n\n## Project Rules\n",
          "utf-8",
        );
      }
      appendFileSync(localPath, `\n- ${text}\n`, "utf-8");
      toast.show({
        variant: "success",
        message: "Added rule to KNIGHTCODE.md!",
      });
      dialog.close();
    } catch (err) {
      toast.show({
        variant: "error",
        message: `Failed to save: ${(err as Error).message}`,
      });
    }
  }, [dialog, toast]);

  useKeyboard((key) => {
    if (key.name === "enter" || key.name === "return") {
      key.preventDefault();
      handleSubmit();
    }
  });

  return (
    <box flexDirection="column" gap={1} width="100%">
      <text>Type a guideline or convention to append to KNIGHTCODE.md:</text>
      <input
        ref={inputRef}
        placeholder="e.g. Always write unit tests for utility functions"
        focused
      />
      <box flexDirection="row" gap={2} marginTop={1}>
        <text fg={colors.success}>[Enter] Submit</text>
        <text fg={colors.dimSeparator}>[Esc] Cancel</text>
      </box>
    </box>
  );
}
