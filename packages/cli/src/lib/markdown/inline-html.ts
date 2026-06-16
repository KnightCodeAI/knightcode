const BR_TAG = /<br\s*\/?>/gi;
const BR_TAG_TEST = /<br\s*\/?>/i;
const BR_TAG_AT_EOL = /<br\s*\/?>\s*$/i;

type Segment = { code: boolean; text: string };

/**
 * Split a line into code-span and non-code segments. Code spans follow the
 * CommonMark rule: an opening backtick run of length N is closed by the next
 * backtick run of exactly length N. An unclosed run is treated as literal text,
 * so `<br>` inside ``double`` or longer spans survives untouched.
 */
function segmentCodeSpans(line: string): Segment[] {
  const segments: Segment[] = [];
  let i = 0;
  let textStart = 0;
  while (i < line.length) {
    if (line[i] !== "`") {
      i++;
      continue;
    }
    // Measure the opening backtick run.
    let open = i;
    while (open < line.length && line[open] === "`") open++;
    const runLen = open - i;
    // Find a closing run of exactly runLen backticks.
    let k = open;
    let closeEnd = -1;
    while (k < line.length) {
      if (line[k] !== "`") {
        k++;
        continue;
      }
      let m = k;
      while (m < line.length && line[m] === "`") m++;
      if (m - k === runLen) {
        closeEnd = m;
        break;
      }
      k = m;
    }
    if (closeEnd === -1) {
      // No matching close — the backticks are literal. Skip past the opening
      // run so it isn't rescanned, leaving it inside a text segment.
      i = open;
      continue;
    }
    if (i > textStart) {
      segments.push({ code: false, text: line.slice(textStart, i) });
    }
    segments.push({ code: true, text: line.slice(i, closeEnd) });
    i = closeEnd;
    textStart = i;
  }
  if (textStart < line.length) {
    segments.push({ code: false, text: line.slice(textStart) });
  }
  return segments;
}

function mapOutsideCodeSpans(
  line: string,
  transform: (segment: string) => string,
): string {
  return segmentCodeSpans(line)
    .map((seg) => (seg.code ? seg.text : transform(seg.text)))
    .join("");
}

/** Split one table cell on <br>, leaving code spans untouched. */
function splitCellOnBreaks(cell: string): string[] {
  const segments: string[] = [""];
  for (const seg of segmentCodeSpans(cell)) {
    if (seg.code) {
      segments[segments.length - 1] += seg.text;
      continue;
    }
    const pieces = seg.text.split(BR_TAG);
    segments[segments.length - 1] += pieces[0]!;
    for (let j = 1; j < pieces.length; j++) segments.push(pieces[j]!);
  }
  return segments.map((s) => s.trim());
}

/**
 * Split a table row into cells on unescaped `|` characters that sit outside
 * code spans. A backslash-escaped `\|` and any pipe inside a code span stay
 * part of the cell. Leading/trailing border pipes produce empty boundary cells
 * the caller drops.
 */
function splitTableCells(body: string): string[] {
  const cells: string[] = [];
  let cur = "";
  for (const seg of segmentCodeSpans(body)) {
    if (seg.code) {
      cur += seg.text;
      continue;
    }
    const text = seg.text;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      if (ch === "\\" && i + 1 < text.length) {
        // Preserve the escape sequence (e.g. \|) verbatim — it's a literal pipe.
        cur += ch + text[i + 1]!;
        i++;
        continue;
      }
      if (ch === "|") {
        cells.push(cur);
        cur = "";
        continue;
      }
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
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
  const indent = /^(\s*)/.exec(line)?.[1] ?? "";
  const body = line.slice(indent.length);

  let cells = splitTableCells(body);
  // Drop the empty boundary cells produced by the optional leading/trailing
  // border pipes (the trailing one may be absent — GFM allows that).
  if (cells.length > 0 && cells[0]!.trim() === "") cells = cells.slice(1);
  if (cells.length > 0 && cells[cells.length - 1]!.trim() === "") {
    cells = cells.slice(0, -1);
  }
  if (cells.length === 0) {
    // No real cells — degrade <br> to a space rather than emit a broken row.
    return [mapOutsideCodeSpans(line, (s) => s.replace(BR_TAG, " "))];
  }

  const split = cells.map(splitCellOnBreaks);
  const height = Math.max(...split.map((segments) => segments.length));
  const rows: string[] = [];
  for (let k = 0; k < height; k++) {
    rows.push(`${indent}| ${split.map((s) => s[k] ?? "").join(" | ")} |`);
  }
  return rows;
}

/**
 * Convert `<br>` / `<br/>` / `<br />` into real line breaks in prose
 * markdown. OpenTUI's native markdown engine renders raw HTML literally, so
 * the tag must be rewritten before rendering:
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
