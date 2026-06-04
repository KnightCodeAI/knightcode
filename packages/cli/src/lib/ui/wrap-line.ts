/** Hard line-wrapping for code/diff rows (no editor-style word wrap). */

/**
 * Hard-wrap `text` to `width` columns. Long tokens are broken mid-word (code
 * has few break points), and leading indentation is re-applied to continuation
 * rows so wrapped code stays visually aligned.
 */
export function wrapText(text: string, width: number): string[] {
  if (width <= 0 || text.length <= width) return [text];

  const indent = /^[ \t]*/.exec(text)?.[0] ?? "";
  // Cap the continuation indent so a deeply-indented line still has room.
  const cont = indent.slice(0, Math.min(indent.length, Math.floor(width / 2)));
  const room = Math.max(1, width - cont.length);

  const rows: string[] = [text.slice(0, width)];
  let rest = text.slice(width);
  while (rest.length > 0) {
    rows.push(cont + rest.slice(0, room));
    rest = rest.slice(room);
  }
  return rows;
}

/**
 * Hard-wrap a styled span run to `width` columns, splitting spans across rows
 * while preserving each span's styling (fg/bg/bold). Used by the diff view so
 * wrapped lines keep their syntax + word-diff colours.
 */
export function wrapSpans<T extends { text: string }>(
  spans: T[],
  width: number,
): T[][] {
  if (width <= 0) return [spans];
  const rows: T[][] = [];
  let cur: T[] = [];
  let curLen = 0;

  for (const span of spans) {
    let text = span.text;
    while (curLen + text.length > width) {
      const take = width - curLen;
      if (take > 0) {
        cur.push({ ...span, text: text.slice(0, take) });
        text = text.slice(take);
      }
      rows.push(cur);
      cur = [];
      curLen = 0;
    }
    if (text.length > 0) {
      cur.push({ ...span, text });
      curLen += text.length;
    }
  }

  if (cur.length > 0 || rows.length === 0) rows.push(cur);
  return rows;
}
