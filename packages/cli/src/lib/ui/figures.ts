/** Glyphs ported from the reference TUI/src/constants/figures.ts. */

/** Assistant/tool bullet: ⏺ aligns better on macOS; ● renders reliably elsewhere. */
export function bulletGlyph(
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "darwin" ? "⏺" : "●";
}

export const BULLET = bulletGlyph();

/** Indented continuation marker before a tool result (dim). */
export const RESULT_GUTTER = "  ⎿  ";

/** Continuation indent for wrapped/multi-line result rows (aligns under ⎿ text). */
export const RESULT_INDENT = "     ";

export const EFFORT_GLYPH = {
  none: "",
  low: "○",
  medium: "◐",
  high: "●",
  max: "◉",
} as const;

export const THINKING_MARK = "✻";
export const BLOCKQUOTE_BAR = "▎";

/** Pulsing-asterisk spinner frames (the reference TUI Spinner/utils.ts). */
export const SPINNER_FRAMES = [
  "·",
  "✢",
  "*",
  "✶",
  "✻",
  "✽",
  "✽",
  "✻",
  "✶",
  "*",
  "✢",
  "·",
] as const;
