import type { SupportedChatModelId } from "@knightcode/shared";
import { useCallback } from "react";
import { useDialog } from "../../providers/dialogs";
import { DialogSearchList } from "../dialog-search-list";

type ModelsDialogContentProps = {
  models: SupportedChatModelId[];
  currentModel?: SupportedChatModelId;
  onSelectModel: (modelId: SupportedChatModelId) => void;
};

export const ModelsDialogContent = ({
  models,
  currentModel,
  onSelectModel,
}: ModelsDialogContentProps) => {
  const dialog = useDialog();

  const handleSelect = useCallback(
    (modelId: SupportedChatModelId) => {
      onSelectModel(modelId);
      dialog.close();
    },
    [dialog, onSelectModel],
  );

  const initialIndex = currentModel ? Math.max(0, models.indexOf(currentModel)) : 0;

  return (
    <DialogSearchList
      items={models}
      initialIndex={initialIndex}
      onSelect={handleSelect}
      filterFn={(modelId, query) =>
        modelId.toLowerCase().includes(query.toLowerCase())
      }
      renderItem={(modelId, isSelected) => (
        <text selectable={false} fg={isSelected ? "black" : "white"}>
          {modelId}
        </text>
      )}
      getKey={(modelId) => modelId}
      placeholder="Search models"
      emptyText="No matching models"
    />
  );
};
