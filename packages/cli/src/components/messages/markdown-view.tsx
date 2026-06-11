import { useMemo } from "react";
import { useTheme } from "../../providers/theme";
import { getSyntaxStyle } from "../../lib/ui/markdown-engine";
import { convertHtmlBreaks } from "../../lib/markdown/inline-html";
import { splitMarkdownBlocks } from "../../lib/markdown/split-blocks";
import { CodeBlock } from "./code-block";

type Props = {
  text: string;
  defaultFg?: string;
  isThinking?: boolean;
  /** Whether this text is still streaming — the trailing prose block renders in
   * the native markdown engine's streaming mode so partial syntax doesn't garble. */
  streaming?: boolean;
};

/**
 * Renders assistant markdown with OpenTUI's native `<markdown>` engine for prose
 * (real `marked` parsing, native tables/lists/blockquotes), while fenced code
 * blocks are split out and highlighted by our generic tokenizer — universal
 * across languages and consistent with the diff view. If the FFI-backed
 * SyntaxStyle can't be built, it degrades to raw text rather than crashing.
 */
export function MarkdownView({
  text,
  defaultFg,
  isThinking,
  streaming = false,
}: Props) {
  const { colors } = useTheme();
  const syntaxStyle = useMemo(() => getSyntaxStyle(colors), [colors]);
  const blocks = useMemo(() => splitMarkdownBlocks(text), [text]);

  const baseFg = defaultFg ?? colors.text;
  const proseFg = isThinking ? colors.dimSeparator : baseFg;

  if (!syntaxStyle) {
    return <text fg={baseFg}>{text}</text>;
  }

  // Only the final prose block is unstable mid-stream; earlier blocks are
  // settled, so streaming mode is scoped to the last one.
  let lastProseIndex = -1;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i]!.type !== "code") {
      lastProseIndex = i;
      break;
    }
  }

  return (
    <box flexDirection="column" width="100%">
      {blocks.map((block, i) =>
        block.type === "code" ? (
          <CodeBlock key={i} code={block.code} lang={block.lang} />
        ) : (
          <box key={i} width="100%">
            <markdown
              content={convertHtmlBreaks(block.text)}
              syntaxStyle={syntaxStyle}
              conceal
              streaming={streaming && i === lastProseIndex}
              fg={proseFg}
            />
          </box>
        ),
      )}
    </box>
  );
}
