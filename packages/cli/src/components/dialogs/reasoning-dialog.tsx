import type { ReasoningEffortLevel } from "@knightcode/shared";
import { useCallback } from "react";
import { useDialog } from "../../providers/dialogs";
import { useTheme } from "../../providers/theme";
import { DialogSearchList } from "../dialog-search-list";

type ReasoningDialogContentProps = {
  currentEffort: ReasoningEffortLevel;
  onSelectEffort: (effort: ReasoningEffortLevel) => void;
};

const OPTIONS: ReasoningEffortLevel[] = [
  "none",
  "low",
  "medium",
  "high",
  "max",
];

export const ReasoningDialogContent = ({
  currentEffort,
  onSelectEffort,
}: ReasoningDialogContentProps) => {
  const dialog = useDialog();
  const { colors } = useTheme();

  const handleSelect = useCallback(
    (effort: ReasoningEffortLevel) => {
      onSelectEffort(effort);
      dialog.close();
    },
    [dialog, onSelectEffort],
  );

  const initialIndex = Math.max(0, OPTIONS.indexOf(currentEffort));

  return (
    <DialogSearchList
      items={OPTIONS}
      initialIndex={initialIndex}
      onSelect={handleSelect}
      filterFn={(effort, query) =>
        effort.toLowerCase().includes(query.toLowerCase())
      }
      renderItem={(effort, isSelected) => {
        let label = effort.toUpperCase();
        if (effort === "none") label = "None (Disable Thinking)";
        if (effort === "max") label = "Max (Extended)";
        return (
          <text selectable={false} fg={isSelected ? colors.inverseText : colors.text}>
            {label}
          </text>
        );
      }}
      getKey={(effort) => effort}
      placeholder="Select reasoning effort"
      emptyText="No matching options"
    />
  );
};
