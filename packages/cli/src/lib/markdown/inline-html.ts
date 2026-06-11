/**
 * Replace `<br>` / `<br/>` / `<br />` with a space in prose markdown. Models
 * emit them inside table cells; OpenTUI's native markdown engine renders raw
 * HTML literally, while claude-code's terminal renderer drops html tokens
 * entirely (utils/markdown.ts, `case 'html'`). A space keeps the cell text
 * readable without breaking the table row the way a newline would. Inline
 * code spans are preserved: a `<br>` inside backticks is left alone.
 */
export function stripHtmlBreaks(prose: string): string {
  // Split on inline code spans so literal `<br>` examples survive.
  return prose
    .split(/(`[^`\n]*`)/)
    .map((segment, i) =>
      i % 2 === 1 ? segment : segment.replace(/<br\s*\/?>/gi, " "),
    )
    .join("");
}
