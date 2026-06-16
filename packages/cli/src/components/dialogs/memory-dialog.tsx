import { useCallback, useState } from "react";
import { useDialog } from "../../providers/dialogs";
import { useToast } from "../../providers/toast";
import { useTheme } from "../../providers/theme";
import { DialogSearchList } from "../dialog-search-list";
import { scanMemoryFiles, type MemoryHeader } from "../../lib/memory/scan";
import { deleteMemory } from "../../lib/memory/store";

export function MemoryDialogContent() {
  const dialog = useDialog();
  const toast = useToast();
  const { colors } = useTheme();

  // Snapshot the auto-memories on open; refresh after a delete.
  const [memories, setMemories] = useState<MemoryHeader[]>(() =>
    scanMemoryFiles(process.cwd()),
  );
  // Two-step delete: first Enter arms (keyed by filePath), second confirms.
  const [armed, setArmed] = useState<string | null>(null);

  const handleSelect = useCallback(
    (m: MemoryHeader) => {
      if (armed === m.filePath) {
        const ok = deleteMemory(process.cwd(), m.name);
        toast.show({
          variant: ok ? "success" : "error",
          message: ok ? `Deleted memory "${m.name}"` : "Delete failed",
        });
        const next = scanMemoryFiles(process.cwd());
        setMemories(next);
        setArmed(null);
        if (next.length === 0) dialog.close();
      } else {
        setArmed(m.filePath);
        toast.show({
          variant: "info",
          message: `Press Enter again to delete "${m.name}" (or move to cancel)`,
        });
      }
    },
    [armed, toast, dialog],
  );

  if (memories.length === 0) {
    return (
      <box flexDirection="column" gap={1} width="100%">
        <text>No auto-memories saved yet.</text>
        <text fg={colors.dimSeparator}>
          Memories are learned automatically as you work. Project guidelines live
          in KNIGHTCODE.md.
        </text>
      </box>
    );
  }

  return (
    <box flexDirection="column" gap={1} width="100%">
      <text fg={colors.dimSeparator}>
        {`Auto-memory (${memories.length}) — ↑↓ select · Enter deletes (twice to confirm) · Esc closes`}
      </text>
      <DialogSearchList
        items={memories}
        onSelect={handleSelect}
        onHighlight={() => setArmed(null)}
        filterFn={(m, query) =>
          (m.description || m.name).toLowerCase().includes(query.toLowerCase())
        }
        renderItem={(m, isSelected) => (
          <text fg={isSelected ? colors.inverseText : colors.text}>
            {`${m.description || m.name}${m.type ? ` [${m.type}]` : ""}`}
          </text>
        )}
        getKey={(m) => m.filePath}
        placeholder="Search memories"
        emptyText="No memories"
      />
    </box>
  );
}
