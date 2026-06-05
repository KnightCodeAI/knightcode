import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { useTheme } from "../../providers/theme";
import { tokenizeLine } from "../../lib/markdown/highlight";
import { tokenColor } from "../../lib/ui/token-color";
import { wrapText } from "../../lib/ui/wrap-line";

type Props = {
  code: string;
  lang?: string;
};

/**
 * A fenced code block, syntax-highlighted by our generic tokenizer (works for
 * every language, consistent with the diff view). Rendered on a subtle surface
 * panel to set it apart from surrounding prose. Long lines hard-wrap to the
 * terminal width so nothing runs off-screen.
 */
export function CodeBlock({ code, lang = "" }: Props) {
  const { colors } = useTheme();
  const { width } = useTerminalDimensions();
  // Leave room for the surface padding + the surrounding chat gutter/padding.
  const contentWidth = Math.max(20, width - 8);
  const lines = code
    .replace(/\n$/, "")
    .split("\n")
    .flatMap((line) => wrapText(line, contentWidth));

  return (
    <box
      flexDirection="column"
      width="100%"
      backgroundColor={colors.surface}
      paddingX={1}
      marginY={1}
    >
      {lines.map((line, i) => {
        const tokens = tokenizeLine(line, lang);
        return (
          <text key={i}>
            {tokens.length === 0
              ? " "
              : tokens.map((t, ti) => (
                  <span
                    key={ti}
                    fg={tokenColor(t.kind, colors)}
                    attributes={
                      t.kind === "comment"
                        ? TextAttributes.ITALIC
                        : undefined
                    }
                  >
                    {t.text}
                  </span>
                ))}
          </text>
        );
      })}
    </box>
  );
}
