// TODO: PDF reading/extraction isn't ported. The Read tool routes .pdf files
// here; until a PDF parser lands these report the feature as unavailable so the
// tool surfaces a clean message rather than crashing.

export type PDFError = {
  reason:
    | 'empty'
    | 'too_large'
    | 'password_protected'
    | 'corrupted'
    | 'unknown'
    | 'unavailable'
  message: string
}

export type PDFResult<T> =
  | { success: true; data: T }
  | { success: false; error: PDFError }

type PDFReadResult = {
  type: 'pdf'
  file: {
    filePath: string
    base64: string
    originalSize: number
  }
}

type PDFExtractPagesResult = {
  type: 'parts'
  file: {
    filePath: string
    originalSize: number
    count: number
    outputDir: string
  }
}

const UNAVAILABLE: PDFError = {
  reason: 'unavailable',
  message: 'Reading PDF files is not supported in this build.',
}

export async function readPDF(
  _filePath: string,
): Promise<PDFResult<PDFReadResult>> {
  return { success: false, error: UNAVAILABLE }
}

export async function getPDFPageCount(_filePath: string): Promise<number | null> {
  return null
}

export async function extractPDFPages(
  _filePath: string,
  _options?: { firstPage?: number; lastPage?: number },
): Promise<PDFResult<PDFExtractPagesResult>> {
  return { success: false, error: UNAVAILABLE }
}
