// TODO: the full shell OutputLine renderer (JSON pretty-printing, URL
// linkification, truncation) lands with the shell tool's transcript view. Only
// the underline-ANSI stripper the fallback error renderer needs lives here.

/**
 * Underline ANSI codes in particular tend to leak out. We don't want to strip
 * all ANSI codes (that loses formatting), so this strips only the underline
 * codes specifically.
 */
export function stripUnderlineAnsi(content: string): string {
  return content.replace(
    // eslint-disable-next-line no-control-regex
    /\x1b\[([0-9]+;)*4(;[0-9]+)*m|\x1b\[4(;[0-9]+)*m|\x1b\[([0-9]+;)*4m/g,
    '',
  )
}
