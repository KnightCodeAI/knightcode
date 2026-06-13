// TODO: PDF reading support lands with the Read tool's binary-format handling.
// Until then PDFs are reported unsupported so the Read prompt omits the PDF
// guidance and the tool path never attempts to parse one.

export function isPDFSupported(): boolean {
  return false
}

export function isPDFExtension(ext: string): boolean {
  return ext.toLowerCase() === '.pdf' || ext.toLowerCase() === 'pdf'
}

/** Parse a `pages` argument like "1-5" or "3" into a 1-based inclusive range. */
export function parsePDFPageRange(
  pages: string,
): { firstPage: number; lastPage: number } | null {
  const trimmed = pages.trim()
  const single = /^(\d+)$/.exec(trimmed)
  if (single) {
    const n = Number(single[1])
    return n >= 1 ? { firstPage: n, lastPage: n } : null
  }
  const range = /^(\d+)\s*-\s*(\d+)$/.exec(trimmed)
  if (range) {
    const first = Number(range[1])
    const last = Number(range[2])
    if (first >= 1 && last >= first) return { firstPage: first, lastPage: last }
  }
  return null
}
