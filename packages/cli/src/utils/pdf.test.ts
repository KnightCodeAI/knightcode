import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readPDF } from './pdf.js'

function tmpFile(name: string, content: Buffer | string): string {
  const dir = mkdtempSync(join(tmpdir(), 'kc-pdf-'))
  const path = join(dir, name)
  writeFileSync(path, content)
  return path
}

// Minimal valid-enough PDF: readPDF only checks the %PDF- header + size.
const MINIMAL_PDF = '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF'

describe('readPDF', () => {
  test('reads a PDF into base64 with the original size', async () => {
    const path = tmpFile('doc.pdf', MINIMAL_PDF)
    const result = await readPDF(path)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe('pdf')
      expect(result.data.file.originalSize).toBe(MINIMAL_PDF.length)
      expect(Buffer.from(result.data.file.base64, 'base64').toString()).toBe(
        MINIMAL_PDF,
      )
    }
  })

  test('rejects an empty file', async () => {
    const result = await readPDF(tmpFile('empty.pdf', ''))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.reason).toBe('empty')
  })

  test('rejects a file without a %PDF- header (e.g. HTML renamed .pdf)', async () => {
    const result = await readPDF(tmpFile('fake.pdf', '<html>nope</html>'))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.reason).toBe('corrupted')
  })
})
