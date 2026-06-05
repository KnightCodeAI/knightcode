import type { ThemeColors } from "../../providers/theme/theme";
import type { TokenKind } from "../markdown/highlight";

/** Maps a syntax token kind to a theme colour (undefined = inherit default fg). */
export function tokenColor(
  kind: TokenKind,
  c: ThemeColors,
): string | undefined {
  switch (kind) {
    case "keyword":
      return c.thinking;
    case "string":
      return c.success;
    case "number":
    case "boolean":
      return c.autoMode;
    case "comment":
      return c.dimSeparator;
    case "function":
      return c.info;
    default:
      return undefined;
  }
}
