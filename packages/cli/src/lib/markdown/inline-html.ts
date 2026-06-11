const BR_TAG = /<br\s*\/?>/gi;
const BR_TAG_TEST = /<br\s*\/?>/i;
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

/** Split one table cell on <br>, leaving code spans untouched. */
function splitCellOnBreaks(cell: string): string[] {
  const segments: string[] = [""];
  const parts = cell.split(/(`[^`\n]*`)/);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (i % 2 === 1) {
      segments[segments.length - 1] += part;
      continue;
    }
    const pieces = part.split(BR_TAG);
    segments[segments.length - 1] += pieces[0]!;
    for (let j = 1; j < pieces.length; j++) segments.push(pieces[j]!);
  }
  return segments.map((s) => s.trim());
}

/** `|---|:---:|` style delimiter row under the header. */
function isTableSeparator(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes("-");
}

/**
 * Expand one table row whose cells contain <br> into several physical rows:
 * each break segment moves to a continuation row with the other columns left
 * empty, so the table renders the cell as wrapped lines while every line
 * stays a valid single-line markdown row.
 */
function expandTableRow(line: string): string[] {
  const match = line.match(/^(\s*)\|(.*)\|\s*$/);
  if (!match) {
    // Non-standard row shape — degrade to a space rather than risk breaking it.
    return [mapOutsideCodeSpans(line, (s) => s.replace(BR_TAG, " "))];
  }
  const indent = match[1]!;
  const cells = match[2]!.split("|").map(splitCellOnBreaks);
  const height = Math.max(...cells.map((segments) => segments.length));
  const rows: string[] = [];
  for (let k = 0; k < height; k++) {
    rows.push(`${indent}| ${cells.map((s) => s[k] ?? "").join(" | ")} |`);
  }
  return rows;
}

/**
 * Convert `<br>` / `<br/>` / `<br />` into real line breaks in prose
 * markdown. OpenTUI's native markdown engine renders raw HTML literally
 * (claude-code's terminal renderer drops html tokens — utils/markdown.ts,
 * `case 'html'`), so the tag must be rewritten before rendering:
 *
 * - Regular prose: a GFM hard break (`"  \n"`); at end of line just the two
 *   trailing spaces, since the existing newline completes the break.
 * - Table body rows: the row is expanded into continuation rows (one per
 *   break segment, other columns empty) — markdown cells can't contain
 *   newlines, but extra rows render as wrapped lines within the table.
 * - Table header rows (the line above the separator): a space — a table can
 *   only have one header line.
 */
export function convertHtmlBreaks(prose: string): string {
  const lines = prose.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!/^\s*\|/.test(line)) {
      out.push(
        mapOutsideCodeSpans(line, (segment) =>
          segment.replace(BR_TAG_AT_EOL, "  ").replace(BR_TAG, "  \n"),
        ),
      );
      continue;
    }
    if (!BR_TAG_TEST.test(line)) {
      out.push(line);
      continue;
    }
    const isHeader = i + 1 < lines.length && isTableSeparator(lines[i + 1]!);
    if (isHeader) {
      out.push(mapOutsideCodeSpans(line, (s) => s.replace(BR_TAG, " ")));
    } else {
      out.push(...expandTableRow(line));
    }
  }
  return out.join("\n");
}
