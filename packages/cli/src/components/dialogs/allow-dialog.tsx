import { useCallback, useRef, useState } from "react";
import { type InputRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useDialog } from "../../providers/dialogs";
import { useToast } from "../../providers/toast";
import {
  loadPermissions,
  allowCommand,
  savePermissions,
} from "../../lib/permissions";

export function AllowDialogContent() {
  const dialog = useDialog();
  const toast = useToast();
  const inputRef = useRef<InputRenderable>(null);
  const [permissions, setPermissions] = useState(() => loadPermissions());
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  const handleAdd = useCallback(() => {
    const text = inputRef.current?.value?.trim() ?? "";
    if (!text) {
      toast.show({
        variant: "error",
        message: "Command pattern cannot be empty",
      });
      return;
    }

    try {
      const before = permissions.allowedCommands;
      allowCommand(text);
      const next = loadPermissions();
      if (!next.allowedCommands.includes(text)) {
        throw new Error("Failed to persist allowlist change");
      }
      setPermissions(loadPermissions());
      if (inputRef.current) {
        // Clear input value
        inputRef.current.value = "";
      }
      toast.show({
        variant: "success",
        message: `Allowed command prefix: "${text}"`,
      });
    } catch (err) {
      toast.show({
        variant: "error",
        message: `Failed to add command: ${(err as Error).message}`,
      });
    }
  }, [toast]);

  const handleDelete = useCallback(
    (indexToDelete: number) => {
      try {
        const updated = {
          allowedCommands: permissions.allowedCommands.filter(
            (_, idx) => idx !== indexToDelete,
          ),
        };
        savePermissions(updated);
        setPermissions(updated);
        toast.show({
          variant: "success",
          message: "Removed command from allowlist",
        });
      } catch (err) {
        toast.show({ variant: "error", message: "Failed to remove command" });
      }
    },
    [permissions, toast],
  );

  useKeyboard((key) => {
    const totalCommands = permissions.allowedCommands.length;
    if (totalCommands === 0) {
      if (key.name === "enter" || key.name === "return") {
        key.preventDefault();
        handleAdd();
      }
      return;
    }
    if (key.name === "up") {
      key.preventDefault();
      setFocusedIndex((prev) => {
        if (prev === null) return totalCommands - 1;
        return prev > 0 ? prev - 1 : null;
      });
    } else if (key.name === "down") {
      key.preventDefault();
      setFocusedIndex((prev) => {
        if (prev === null) return 0;
        return prev < totalCommands - 1 ? prev + 1 : null;
      });
    } else if (key.name === "tab") {
      key.preventDefault();
      setFocusedIndex((prev) => {
        if (prev === null) return 0;
        return prev < totalCommands - 1 ? prev + 1 : null;
      });
    } else if (key.name === "enter" || key.name === "return") {
      key.preventDefault();
      if (focusedIndex !== null) {
        handleDelete(focusedIndex);
        setFocusedIndex(null);
      } else {
        handleAdd();
      }
    } else if (key.name === "space" && focusedIndex !== null) {
      key.preventDefault();
      handleDelete(focusedIndex);
      setFocusedIndex(null);
    }
  });

  return (
    <box flexDirection="column" gap={1} width="100%">
      <text>Allowed Command prefixes (will skip prompt):</text>

      {permissions.allowedCommands.length === 0 ? (
        <text fg="gray"> No allowed commands yet.</text>
      ) : (
        <box flexDirection="column" gap={0} marginY={1}>
          {permissions.allowedCommands.map((cmd, idx) => {
            const isFocused = focusedIndex === idx;
            return (
              <box key={idx} flexDirection="row" gap={2}>
                <text fg="green">• {cmd}</text>
                <text
                  {...({
                    fg: isFocused ? "yellow" : "red",
                    focusable: true,
                    tabIndex: 0,
                    role: "button",
                    onFocus: () => setFocusedIndex(idx),
                    onBlur: () => setFocusedIndex(null),
                    onMouseDown: () => handleDelete(idx),
                    onKeyDown: (e: any) => {
                      if (
                        e.name === "enter" ||
                        e.name === "return" ||
                        e.name === "space"
                      ) {
                        handleDelete(idx);
                      }
                    },
                  } as any)}
                >
                  {isFocused ? "> [Remove] <" : "[Remove]"}
                </text>
              </box>
            );
          })}
        </box>
      )}

      <text>Type a new command prefix to allow (e.g. "bun test"):</text>
      <input
        ref={inputRef}
        placeholder="e.g. bun test"
        focused={focusedIndex === null}
      />
      <box flexDirection="row" gap={2} marginTop={1}>
        <text fg="green">[Enter] Add</text>
        <text fg="gray">[Esc] Close</text>
      </box>
    </box>
  );
}
