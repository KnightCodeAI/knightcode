import { TextAttributes } from "@opentui/core";
import { useTheme } from "../../providers/theme";

type Props = {
  model: string;
  originalMessageCount: number;
  summary: string;
  summaryCount?: number;
  preservedCount?: number;
};

export function CompactionMessage({
  model,
  originalMessageCount,
  summary,
  summaryCount = 1,
  preservedCount = 4,
}: Props) {
  const { colors } = useTheme();

  return (
    <box width="100%" flexDirection="column" marginY={1}>
      <box
        border={["top", "bottom", "left", "right"]}
        borderColor={colors.primary}
        width="100%"
        padding={1}
        flexDirection="column"
        gap={0}
      >
        <box flexDirection="row" justifyContent="space-between" width="100%">
          <box flexDirection="row" gap={1}>
            <text fg={colors.primary} attributes={TextAttributes.BOLD}>
              ⚡ CONTEXT COMPACTED
            </text>
            <text fg={colors.dimSeparator}>•</text>
            <text fg="white">{model.replace(/:free$/, "")}</text>
          </box>
          <text fg={colors.success} attributes={TextAttributes.BOLD}>
            Free
          </text>
        </box>

        <box flexDirection="row" gap={1} marginTop={1}>
          <text fg={colors.dimSeparator}>Consolidated:</text>
          <text fg="white" attributes={TextAttributes.BOLD}>
            {originalMessageCount} messages
          </text>
          <text fg={colors.dimSeparator}>➔</text>
          <text fg="white" attributes={TextAttributes.BOLD}>
            {summaryCount + preservedCount} messages ({summaryCount} summary +{" "}
            {preservedCount} preserved)
          </text>
        </box>

        <box
          border={["top"]}
          borderColor={colors.thinkingBorder}
          marginTop={1}
          paddingTop={1}
          flexDirection="column"
          width="100%"
          gap={0}
        >
          <text
            fg={colors.dimSeparator}
            attributes={TextAttributes.BOLD}
            marginBottom={1}
          >
            ENGINEERING SUMMARY:
          </text>
          {summary.split("\n").map((line, index) => {
            const isHeader = line.startsWith("#");
            const fgColor = isHeader ? colors.primary : "white";
            const attributes = isHeader ? [TextAttributes.BOLD] : [];
            return (
              <text key={index} fg={fgColor} attributes={attributes as any}>
                {line}
              </text>
            );
          })}
        </box>
      </box>
    </box>
  );
}
