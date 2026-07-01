// Maps file extensions to LSP `languageId` strings used in textDocument/didOpen.
// Only covers the languages served by the built-in servers (serverRegistry.ts);
// unknown extensions fall back to "plaintext".

import { extname } from 'path'

const LANGUAGE_ID_BY_EXT: Record<string, string> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascriptreact',
  '.py': 'python',
  '.pyi': 'python',
  '.go': 'go',
  '.rs': 'rust',
}

export function languageIdForFile(filePath: string): string {
  return LANGUAGE_ID_BY_EXT[extname(filePath).toLowerCase()] ?? 'plaintext'
}
