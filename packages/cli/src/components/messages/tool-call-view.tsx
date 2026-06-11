import { TextAttributes } from "@opentui/core";
import { useState } from "react";
import { useTheme } from "../../providers/theme";
import { useVerbose } from "../../providers/verbose";
import { BULLET, RESULT_GUTTER } from "../../lib/ui/figures";
import { useSpinnerFrame } from "../../lib/ui/spinner-frame";
import { toolStatus } from "../../lib/ui/tool-presentation";
import { toolCallLine, toolResultSummary } from "../../lib/ui/tool-line";

type Props = {
  toolName: string;
  input: unknown;
  state?: string;
  output?: unknown;
  errorText?: string;
  /** Start expanded (e.g. while pending confirmation). */
  defaultExpanded?: boolean;
  /** True while the engine is executing this call — animates the bullet. */
  running?: boolean;
};

function stringifyOutput(output: unknown): string {
  if (output == null) return "";
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

/**
 * A tool call rendered the reference TUI-style: a `⏺ ToolName(args)` bullet line and
 * an indented `⎿` result row. The result collapses to a one-line summary with a
 * `(ctrl+o to expand)` hint; a per-row click or global Ctrl+O (verbose) expands
 * it to the full output.
 */
export function ToolCallView({
  toolName,
  input,
  state,
  output,
  errorText,
  defaultExpanded = false,
  running = false,
}: Props) {
  const { colors } = useTheme();
  const { verbose } = useVerbose();
  const [expanded, setExpanded] = useState(defaultExpanded);

  const status = toolStatus({ state });
  // useSpinnerFrame(0) installs no interval, so idle rows don't tick.
  const spinnerFrame = useSpinnerFrame(running ? 120 : 0);
  const isRunning = running && status === "running";
  const bulletColor =
    status === "error"
      ? colors.error
      : status === "success"
        ? colors.primary
        : colors.dimSeparator;

  const summary = toolResultSummary(toolName, input, output, errorText);
  const detail = errorText ?? stringifyOutput(output);
  const detailLines = detail
    ? detail.split("\n").slice(0, verbose ? 400 : 40)
    : [];
  const hasResult = summary.length > 0 || detailLines.length > 0;
  const hasMore = detailLines.length > 1;
  const isExpanded = verbose || expanded;
  const resultColor = status === "error" ? colors.error : colors.dimSeparator;

  return (
    <box flexDirection="column" width="100%">
      <box flexDirection="row" width="100%">
        <text fg={isRunning ? colors.primary : bulletColor}>
          {isRunning ? spinnerFrame : BULLET}{" "}
        </text>
        <box flexGrow={1} flexShrink={1} overflow="hidden">
          <text>{toolCallLine(toolName, input)}</text>
        </box>
      </box>

      {hasResult ? (
        <box
          flexDirection="row"
          width="100%"
          onMouseDown={() => hasMore && setExpanded((e) => !e)}
        >
          <text fg={colors.dimSeparator}>{RESULT_GUTTER}</text>
          <box flexGrow={1} flexShrink={1} flexDirection="column">
            {isExpanded && detailLines.length > 0 ? (
              detailLines.map((line, i) => (
                <text key={i} fg={resultColor}>
                  {line || " "}
                </text>
              ))
            ) : (
              <text fg={resultColor} attributes={TextAttributes.DIM}>
                {summary || "…"}
                {hasMore ? " (ctrl+o to expand)" : ""}
              </text>
            )}
          </box>
        </box>
      ) : null}
    </box>
  );
}
