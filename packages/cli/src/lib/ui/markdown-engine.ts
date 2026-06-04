import { SyntaxStyle, type StyleDefinitionInput } from "@opentui/core";
import type { ThemeColors } from "../../providers/theme/theme";

/**
 * SyntaxStyle for OpenTUI's native `<markdown>` renderable. Fenced code blocks
 * are highlighted by our own tokenizer (see CodeBlock), so no tree-sitter
 * client is needed here — this only styles markdown markup scopes. Guarded: if
 * the FFI build fails, callers degrade to raw text.
 */

const styleCache = new Map<string, SyntaxStyle>();

function styleMap(c: ThemeColors): Record<string, StyleDefinitionInput> {
  return {
    // --- code scopes (javascript/typescript/etc. highlights.scm) ---
    keyword: { fg: c.thinking, bold: true },
    string: { fg: c.success },
    "string.special": { fg: c.success },
    "string.escape": { fg: c.autoMode },
    number: { fg: c.autoMode },
    constant: { fg: c.autoMode },
    "constant.builtin": { fg: c.autoMode },
    comment: { fg: c.dimSeparator, italic: true },
    function: { fg: c.info },
    "function.method": { fg: c.info },
    "function.builtin": { fg: c.info },
    constructor: { fg: c.info },
    property: { fg: c.primary },
    operator: { fg: c.dimSeparator },
    "punctuation.bracket": { fg: c.dimSeparator },
    "punctuation.delimiter": { fg: c.dimSeparator },
    "punctuation.special": { fg: c.dimSeparator },
    "variable.builtin": { fg: c.thinking },
    // --- markdown markup scopes ---
    "markup.heading": { fg: c.primary, bold: true },
    "markup.strong": { bold: true },
    "markup.italic": { italic: true },
    "markup.link": { fg: c.info },
    "markup.link.label": { fg: c.info },
    "markup.link.url": { fg: c.info, underline: true },
    "markup.quote": { fg: c.dimSeparator, italic: true },
    "markup.raw": { fg: c.info },
    "markup.raw.block": { fg: c.info },
    "markup.list": { fg: c.autoMode },
    "markup.strikethrough": { dim: true },
  };
}

/** A SyntaxStyle for the given theme, cached. Returns null if FFI build fails. */
export function getSyntaxStyle(colors: ThemeColors): SyntaxStyle | null {
  const key = `${colors.primary}|${colors.thinking}|${colors.success}|${colors.autoMode}|${colors.info}|${colors.dimSeparator}`;
  const hit = styleCache.get(key);
  if (hit) return hit;
  try {
    const style = SyntaxStyle.fromStyles(styleMap(colors));
    styleCache.set(key, style);
    return style;
  } catch {
    return null;
  }
}
