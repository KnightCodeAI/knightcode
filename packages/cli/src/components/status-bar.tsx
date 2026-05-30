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

type Props = {
  tokenStats?: {
    inputTokens: number;
    outputTokens: number;
    totalCost: number;
    lastInputTokens?: number;
  };
};

export function StatusBar({ tokenStats }: Props) {
  const { mode, model, reasoningEffort } = usePromptConfig();
  const { colors } = useTheme();

  const modelDef = findSupportedChatModel(model);
  const showReasoning =
    modelDef?.supportsThinking && reasoningEffort !== "none";
  const modelText = model.replace(/:free$/, "");

  const contextLimit = modelDef?.contextWindow || 128000;
  const lastInputTokens = tokenStats?.lastInputTokens;

  let contextRemainingElement = null;
  if (lastInputTokens !== undefined) {
    const remaining = Math.max(0, contextLimit - lastInputTokens);
    const percentLeft = Math.round((remaining / contextLimit) * 100);
    const remainingK = (remaining / 1000).toFixed(0);
    const limitK = (contextLimit / 1000).toFixed(0);

    let percentColor = colors.success;
    if (percentLeft <= 30) {
      percentColor = colors.error;
    } else if (percentLeft <= 50) {
      percentColor = colors.primary;
    }

    contextRemainingElement = (
      <>
        <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
          •
        </text>
        <text fg={colors.dimSeparator}>ctx: </text>
        <text fg={percentColor}>{percentLeft}%</text>
        <text fg={colors.dimSeparator}>
          ({remainingK}k/{limitK}k left)
        </text>
      </>
    );
  }

  return (
    <box flexDirection="row" gap={1} width="100%">
      <box flexDirection="row" gap={1}>
        <text
          fg={
            mode === Mode.PLAN
              ? colors.planMode
              : mode === Mode.AUTO
                ? colors.autoMode
                : colors.primary
          }
        >
          {mode === Mode.PLAN ? "Plan" : mode === Mode.AUTO ? "Auto" : "Build"}
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

        {tokenStats &&
          (tokenStats.inputTokens > 0 || tokenStats.outputTokens > 0) && (
            <>
              <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                •
              </text>
              <text fg={colors.info}>
                {tokenStats.totalCost > 0
                  ? `$${tokenStats.totalCost.toFixed(4)}`
                  : "Free"}{" "}
                (
                {(
                  (tokenStats.inputTokens + tokenStats.outputTokens) /
                  1000
                ).toFixed(1)}
                k tkn)
              </text>
            </>
          )}

        {contextRemainingElement}
      </box>
    </box>
  );
}
