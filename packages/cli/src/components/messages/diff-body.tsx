import { RGBA, TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { useTheme } from "../../providers/theme";
import type { ThemeColors } from "../../providers/theme/theme";
import { buildDiffRows, type DiffRow } from "../../lib/ui/diff-rows";
import { wordDiff, type WordSegment } from "../../lib/ui/word-diff";
import { tokenizeLine, langFromPath } from "../../lib/markdown/highlight";
import { tokenColor } from "../../lib/ui/token-color";
import { wrapSpans } from "../../lib/ui/wrap-line";

/** #RRGGBB → opaque RGBA for use as a box background. */
function hexToRgba(hex: string): RGBA {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return RGBA.fromInts(0, 0, 0, 255);
  const n = parseInt(m[1]!, 16);
  return RGBA.fromInts((n >> 16) & 255, (n >> 8) & 255, n & 255, 255);
}

// If a paired line changed more than this fraction, skip word highlighting —
// scattering tiny common tokens reads worse than a plain full-line change.
const WORD_DIFF_THRESHOLD = 0.5;

type Props = {
  oldString: string;
  newString: string;
  /** Source path, used only to pick a syntax-highlight language. */
  filePath?: string;
};

function lineNumberFor(row: DiffRow): number | undefined {
  if (row.kind === "added") return row.newNo;
  if (row.kind === "removed") return row.oldNo;
  return row.newNo ?? row.oldNo;
}

function changedFraction(segs: WordSegment[]): number {
  let changed = 0;
  let total = 0;
  for (const s of segs) {
    total += s.text.length;
    if (s.changed) changed += s.text.length;
  }
  return total === 0 ? 0 : changed / total;
}

/** Pair consecutive removed→added runs and attach intra-line word segments. */
function attachWordSegments(rows: DiffRow[]): Map<number, WordSegment[]> {
  const segMap = new Map<number, WordSegment[]>();
  let k = 0;
  while (k < rows.length) {
    if (rows[k]!.kind !== "removed") {
      k++;
      continue;
    }
    const rem: number[] = [];
    while (k < rows.length && rows[k]!.kind === "removed") rem.push(k++);
    const add: number[] = [];
    while (k < rows.length && rows[k]!.kind === "added") add.push(k++);
    if (add.length === 0) continue;

    const pairs = Math.min(rem.length, add.length);
    for (let p = 0; p < pairs; p++) {
      const { removed, added } = wordDiff(
        rows[rem[p]!]!.text,
        rows[add[p]!]!.text,
      );
      if (
        changedFraction(removed) <= WORD_DIFF_THRESHOLD &&
        changedFraction(added) <= WORD_DIFF_THRESHOLD
      ) {
        segMap.set(rem[p]!, removed);
        segMap.set(add[p]!, added);
      }
    }
  }
  return segMap;
}

type Span = { text: string; fg?: string; bg?: RGBA; bold?: boolean };

/** Syntax-highlight a chunk of code into spans, carrying an optional change bg. */
function codeSpans(
  text: string,
  lang: string,
  colors: ThemeColors,
  bg?: RGBA,
  bold?: boolean,
): Span[] {
  return tokenizeLine(text, lang).map((t) => ({
    text: t.text,
    fg: tokenColor(t.kind, colors),
    bg,
    bold,
  }));
}

/** Build the rendered spans for one diff line: syntax colors + word-diff bg. */
function lineSpans(
  row: DiffRow,
  segs: WordSegment[] | undefined,
  lang: string,
  colors: ThemeColors,
  wordBg: RGBA,
): Span[] {
  if (segs) {
    return segs.flatMap((s) =>
      codeSpans(s.text, lang, colors, s.changed ? wordBg : undefined, s.changed),
    );
  }
  return codeSpans(row.text, lang, colors);
}

/**
 * the reference TUI's StructuredDiff look: one right-aligned line-number gutter, a
 * sigil, and the code — on a solid full-width add/remove background. The code
 * is syntax-highlighted, and the specific words that changed sit on a brighter
 * background.
 */
export function DiffBody({ oldString, newString, filePath }: Props) {
  const { colors } = useTheme();
  const { width } = useTerminalDimensions();
  const lang = langFromPath(filePath ?? "");
  const { rows } = buildDiffRows(oldString, newString);
  const segMap = attachWordSegments(rows);

  // Diff bar backgrounds — the reference TUI's themed diff colours.
  const addedBg = hexToRgba(colors.diffAdded);
  const removedBg = hexToRgba(colors.diffRemoved);
  const addedWordBg = hexToRgba(colors.diffAddedWord);
  const removedWordBg = hexToRgba(colors.diffRemovedWord);

  const maxNo = rows.reduce((m, r) => {
    const n = lineNumberFor(r);
    return n != null && n > m ? n : m;
  }, 1);
  const numWidth = String(maxNo).length;
  const gutterWidth = numWidth + 4; // " " + number + " " + sigil + " "
  // Leave room for the surrounding chat/dialog padding so wrapped code keeps the
  // full-width add/remove bar without spilling past the edge.
  const contentWidth = Math.max(20, width - 8 - gutterWidth);
  const blankGutter = " ".repeat(gutterWidth);

  return (
    <box
      flexDirection="column"
      width="100%"
      border={["top", "bottom"]}
      borderColor={colors.dimSeparator}
    >
      {rows.map((row, i) => {
        const isAdd = row.kind === "added";
        const isDel = row.kind === "removed";
        const bg = isAdd ? addedBg : isDel ? removedBg : undefined;
        const wordBg = isAdd ? addedWordBg : removedWordBg;
        const sigil = isAdd ? "+" : isDel ? "-" : " ";
        const n = lineNumberFor(row);
        const numStr = (n != null ? String(n) : "").padStart(numWidth, " ");
        const gutter = ` ${numStr} ${sigil} `;
        const spans = lineSpans(row, segMap.get(i), lang, colors, wordBg);
        // Wrap the styled spans so long lines flow onto extra rows; continuation
        // rows get a blank gutter and share the same bar background.
        const wrapped = wrapSpans(spans, contentWidth);

        return (
          <box
            key={i}
            flexDirection="column"
            width="100%"
            backgroundColor={bg}
          >
            {wrapped.map((rowSpans, wi) => (
              <text key={wi}>
                <span attributes={TextAttributes.DIM}>
                  {wi === 0 ? gutter : blankGutter}
                </span>
                {rowSpans.map((s, si) => (
                  <span
                    key={si}
                    fg={s.fg}
                    bg={s.bg}
                    attributes={s.bold ? TextAttributes.BOLD : undefined}
                  >
                    {s.text}
                  </span>
                ))}
              </text>
            ))}
          </box>
        );
      })}
    </box>
  );
}
