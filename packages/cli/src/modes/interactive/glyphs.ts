import { visibleWidth } from "@knightcode/tui";

/**
 * Transcript glyph vocabulary.
 *
 * `⏺` is better vertically aligned but is not reliably present in the default
 * fonts on Windows/Linux, so those platforms fall back to `●`.
 */
const isDarwin = process.platform === "darwin";

/** Bullet before each assistant text block and tool call. */
export const BULLET = isDarwin ? "⏺" : "●";

/** Result continuation marker, e.g. `  ⎿  Read 84 lines`. */
export const RESULT_MARKER = "⎿";

/** Spinner / thinking marker. */
export const ASTERISK = "✻";

/** User prompt marker. */
export const USER_MARKER = ">";

/** Gutter written before the first line of a tool call or assistant block. */
export const BULLET_GUTTER = `${BULLET} `;

/** Gutter written before continuation lines of a tool call or assistant block. */
export const BLOCK_INDENT = " ".repeat(visibleWidth(BULLET_GUTTER));

/** Gutter written before the first line of a tool result. */
export const RESULT_GUTTER = `  ${RESULT_MARKER}  `;

/** Gutter written before continuation lines of a tool result. */
export const RESULT_INDENT = " ".repeat(visibleWidth(RESULT_GUTTER));

/** Gutter written before the first line of a user message. */
export const USER_GUTTER = `${USER_MARKER} `;

/** Gutter written before continuation lines of a user message. */
export const USER_INDENT = " ".repeat(visibleWidth(USER_GUTTER));
