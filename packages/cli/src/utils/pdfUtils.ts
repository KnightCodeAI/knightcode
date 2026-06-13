// TODO: PDF reading support lands with the Read tool's binary-format handling.
// Until then PDFs are reported unsupported so the Read prompt omits the PDF
// guidance and the tool path never attempts to parse one.

export function isPDFSupported(): boolean {
  return false
}
