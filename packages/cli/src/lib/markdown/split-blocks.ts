export type MarkdownBlock =
  | { type: "prose"; text: string }
  | { type: "code"; code: string; lang: string };

/**
 * Splits markdown into prose runs and fenced code blocks, so prose can go to
 * the native `<markdown>` engine while code blocks are highlighted by our
 * generic tokenizer (consistent across every language, matching the diffs).
 * An unterminated fence (still streaming) is treated as code to end of input.
 */
export function splitMarkdownBlocks(md: string): MarkdownBlock[] {
  const lines = md.split("\n");
  const blocks: MarkdownBlock[] = [];
  let prose: string[] = [];

  const flushProse = () => {
    if (prose.length > 0) {
      blocks.push({ type: "prose", text: prose.join("\n") });
      prose = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const open = lines[i]!.match(/^ {0,3}```([^\s`]+)?(?:[ \t].*)?$/);
    if (open) {
      flushProse();
      const lang = open[1] ?? "";
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) {
        code.push(lines[i]!);
        i++;
      }
      i++; // consume the closing fence (no-op at EOF)
      blocks.push({ type: "code", code: code.join("\n"), lang });
    } else {
      prose.push(lines[i]!);
      i++;
    }
  }
  flushProse();
  return blocks;
}
