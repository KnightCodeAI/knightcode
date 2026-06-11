const BR_TAG = /<br\s*\/?>/gi;
const BR_TAG_AT_EOL = /<br\s*\/?>\s*$/i;

function mapOutsideCodeSpans(
  line: string,
  transform: (segment: string) => string,
): string {
  // Split on inline code spans so literal `<br>` examples survive.
  return line
    .split(/(`[^`\n]*`)/)
    .map((segment, i) => (i % 2 === 1 ? segment : transform(segment)))
    .join("");
}

/**
 * Convert `<br>` / `<br/>` / `<br />` into real line breaks in prose
 * markdown. OpenTUI's native markdown engine renders raw HTML literally
 * (claude-code's terminal renderer drops html tokens — utils/markdown.ts,
 * `case 'html'`), so the tag must be rewritten before rendering:
 *
 * - Regular prose: a GFM hard break (`"  \n"`); at end of line just the two
 *   trailing spaces, since the existing newline completes the break.
 * - Table rows (line starts with `|`): a space — markdown tables are
 *   line-based, so a newline inside a cell would split the row and destroy
 *   the table. No terminal renderer can break a line inside a cell.
 */
export function convertHtmlBreaks(prose: string): string {
  return prose
    .split("\n")
    .map((line) => {
      const isTableRow = /^\s*\|/.test(line);
      return mapOutsideCodeSpans(line, (segment) =>
        isTableRow
          ? segment.replace(BR_TAG, " ")
          : segment.replace(BR_TAG_AT_EOL, "  ").replace(BR_TAG, "  \n"),
      );
    })
    .join("\n");
}
