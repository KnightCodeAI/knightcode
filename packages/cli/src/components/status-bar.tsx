import { findSupportedChatModel, Mode } from "@knightcode/shared";
import { TextAttributes } from "@opentui/core";
import { usePromptConfig } from "../providers/prompt-config";
import { useTheme } from "../providers/theme";
import type { ThemeColors } from "../providers/theme/theme";

function getReasoningColor(level: string, colors: ThemeColors): string {
  switch (level) {
    case "low":
      return colors.info;
    case "medium":
      return colors.primary;
    case "high":
      return colors.planMode;
    case "max":
      return colors.success;
    default:
      return colors.dimSeparator;
  }
}

export function StatusBar() {
  const { mode, model, reasoningEffort } = usePromptConfig();
  const { colors } = useTheme();

  const modelDef = findSupportedChatModel(model);
  const showReasoning =
    modelDef?.supportsThinking && reasoningEffort !== "none";
  const modelText = model.replace(/:free$/, "");

  return (
    <box flexDirection="row" gap={1}>
      <text fg={mode === Mode.PLAN ? colors.planMode : colors.primary}>
        {mode === Mode.PLAN ? "Plan" : "Build"}
      </text>

      <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
        ›
      </text>
      <text>{modelText}</text>
      {showReasoning && (
        <>
          <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
            •
          </text>
          <text fg={getReasoningColor(reasoningEffort, colors)}>
            ✦ {reasoningEffort}
          </text>
        </>
      )}
    </box>
  );
}
