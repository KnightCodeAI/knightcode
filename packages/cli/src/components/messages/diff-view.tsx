import { TextAttributes } from "@opentui/core";
import { useTheme } from "../../providers/theme";
import { diffSummary } from "../../lib/ui/diff-summary";
import { shouldRenderDiffBody } from "../../lib/ui/diff-visibility";
import { BULLET, RESULT_GUTTER } from "../../lib/ui/figures";
import { DiffBody } from "./diff-body";

type Props = {
  filePath: string;
  oldString: string;
  newString: string;
  pending?: boolean;
  errorText?: string;
  /** Tool part state — the diff body only renders on `output-available`. */
  state?: string;
};

/**
 * An applied file edit, rendered the reference TUI-style:
 *   ⏺ Update(path)
 *     ⎿ Added N lines, removed M line
 *     <syntax-highlighted diff>
 */
export function DiffView({
  filePath,
  oldString,
  newString,
  errorText,
  state,
}: Props) {
  const { colors } = useTheme();
  const { additions, removals } = diffSummary(oldString, newString);
  const showBody = shouldRenderDiffBody(state, errorText);
  const verb = oldString.length === 0 ? "Create" : "Update";
  const dim = TextAttributes.DIM;
  const dimBold = TextAttributes.DIM | TextAttributes.BOLD;

  return (
    <box flexDirection="column" width="100%" marginY={1}>
      <box flexDirection="row" width="100%">
        <text fg={colors.primary}>{BULLET} </text>
        <text attributes={TextAttributes.BOLD}>{verb}</text>
        <text fg={colors.dimSeparator}>({filePath})</text>
      </box>

      <text attributes={dim}>
        <span attributes={dim}>{RESULT_GUTTER}</span>
        {errorText ? (
          <span fg={colors.error}>Failed: {errorText}</span>
        ) : (
          <>
            {additions > 0 ? (
              <span attributes={dim}>
                Added <span attributes={dimBold}>{additions}</span>{" "}
                {additions === 1 ? "line" : "lines"}
              </span>
            ) : null}
            {additions > 0 && removals > 0 ? <span attributes={dim}>, </span> : null}
            {removals > 0 ? (
              <span attributes={dim}>
                {additions === 0 ? "R" : "r"}emoved{" "}
                <span attributes={dimBold}>{removals}</span>{" "}
                {removals === 1 ? "line" : "lines"}
              </span>
            ) : null}
          </>
        )}
      </text>

      {showBody ? (
        <DiffBody
          oldString={oldString}
          newString={newString}
          filePath={filePath}
        />
      ) : null}
    </box>
  );
}
