import { computeLineDiff } from "../git/diff";

export type DiffRowKind = "added" | "removed" | "context";

export type DiffRow = {
  kind: DiffRowKind;
  text: string;
  oldNo?: number;
  newNo?: number;
};

export type BuildDiffRowsOptions = {
  maxChars?: number;
  maxLines?: number;
};

const DEFAULT_MAX_CHARS = 10_000;
const DEFAULT_MAX_LINES = 500;

/**
 * Line-numbered diff rows from old/new strings, with a single-row truncation
 * placeholder when the change is too large to render usefully.
 */
export function buildDiffRows(
  oldString: string,
  newString: string,
  options: BuildDiffRowsOptions = {},
): { rows: DiffRow[]; truncated: boolean } {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;

  const combinedChars = oldString.length + newString.length;
  if (combinedChars > maxChars) {
    return {
      truncated: true,
      rows: [
        {
          kind: "context",
          text: `[Diff too large to display (${combinedChars} characters)]`,
        },
      ],
    };
  }
  const combinedLines =
    oldString.split("\n").length + newString.split("\n").length;
  if (combinedLines > maxLines) {
    return {
      truncated: true,
      rows: [
        {
          kind: "context",
          text: `[Diff too large to display (${combinedChars} characters, ${combinedLines} lines)]`,
        },
      ],
    };
  }

  let oldNo = 0;
  let newNo = 0;
  const rows: DiffRow[] = computeLineDiff(oldString, newString).map((line) => {
    if (line.type === "added") {
      newNo += 1;
      return { kind: "added", text: line.content, newNo };
    }
    if (line.type === "deleted") {
      oldNo += 1;
      return { kind: "removed", text: line.content, oldNo };
    }
    oldNo += 1;
    newNo += 1;
    return { kind: "context", text: line.content, oldNo, newNo };
  });

  return { rows, truncated: false };
}
