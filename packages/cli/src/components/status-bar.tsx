import { findSupportedChatModel, Mode } from "@repo/shared";
import { TextAttributes } from "@opentui/core";
import { usePromptConfig } from "../providers/prompt-config";
import { useTheme } from "../providers/theme";
import type { ThemeColors } from "../providers/theme/theme";
import { formatContextWindow, type TokenStats } from "../lib/ui/status-format";
import { EFFORT_GLYPH } from "../lib/ui/figures";
import { useUpdateCheck } from "../hooks/use-update-check";

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

export function StatusBar({ tokenStats }: { tokenStats?: TokenStats }) {
  const { mode, model, reasoningEffort } = usePromptConfig();
  const { colors } = useTheme();
  const updateVersion = useUpdateCheck();

  const modelDef = findSupportedChatModel(model);
  const showReasoning = modelDef?.supportsThinking && reasoningEffort !== "none";
  const modelText = model.replace(/:free$/, "");
  const contextLimit = modelDef?.contextWindow || 128000;

  const ctx = tokenStats
    ? formatContextWindow(tokenStats.lastInputTokens, contextLimit)
    : null;
  const ctxColor =
    ctx?.severity === "crit"
      ? colors.error
      : ctx?.severity === "warn"
        ? colors.primary
        : colors.success;

  const sep = (
    <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
      •
    </text>
  );

  return (
    <box flexDirection="row" gap={1} width="100%">
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

      {showReasoning ? (
        <>
          {sep}
          <text fg={getReasoningColor(reasoningEffort, colors)}>
            {EFFORT_GLYPH[reasoningEffort]} {reasoningEffort}
          </text>
        </>
      ) : null}

      {ctx ? (
        <>
          {sep}
          <text fg={colors.dimSeparator}>ctx: </text>
          <text fg={ctxColor}>{ctx.percentLeft}%</text>
          <text fg={colors.dimSeparator}>
            ({ctx.remainingK}k/{ctx.limitK}k left)
          </text>
        </>
      ) : null}

      {updateVersion ? (
        <>
          {sep}
          <text fg={colors.success}>★ v{updateVersion} available</text>
        </>
      ) : null}
    </box>
  );
}
