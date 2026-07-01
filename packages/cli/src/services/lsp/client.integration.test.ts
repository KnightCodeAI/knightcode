// End-to-end exercise of LSPClient against a self-contained mock language
// server that speaks the LSP base protocol (Content-Length framing + JSON-RPC)
// by hand. Proves the real pipeline — spawn, vscode-jsonrpc connection,
// initialize handshake, document sync, a request/response round trip, PUSH
// diagnostics feeding LSPDiagnosticRegistry, and PULL diagnostics via
// waitForDiagnostics — without a real server binary installed.

import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { LSPClient } from './client.js'
import {
  checkForLSPDiagnostics,
  clearAllLSPDiagnostics,
} from './LSPDiagnosticRegistry.js'
import type { LSPServerDef } from './serverRegistry.js'

// A minimal LSP server: parses Content-Length frames, answers initialize,
// definition, hover, and pull-diagnostic requests, and PUSHES a publishDiagnostics
// notification whenever a document is opened. diagnosticProvider in initialize
// advertises static pull-diagnostics support.
const MOCK_SERVER = String.raw`
let buf = Buffer.alloc(0)
function send(msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf8')
  process.stdout.write('Content-Length: ' + body.length + '\r\n\r\n')
  process.stdout.write(body)
}
function pushDiag(uri, message) {
  send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: {
    uri,
    diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } }, severity: 1, message }],
  }})
}
function handle(msg) {
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: { capabilities: { textDocumentSync: 1, definitionProvider: true, diagnosticProvider: {} } } })
    return
  }
  if (msg.method === 'textDocument/didOpen') {
    pushDiag(msg.params.textDocument.uri, 'push problem')
    return
  }
  if (msg.method === 'textDocument/definition') {
    send({ jsonrpc: '2.0', id: msg.id, result: [{ uri: msg.params.textDocument.uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } } }] })
    return
  }
  if (msg.method === 'textDocument/diagnostic') {
    send({ jsonrpc: '2.0', id: msg.id, result: { kind: 'full', items: [{ range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } }, severity: 1, message: 'pull problem' }] } })
    return
  }
  // Answer any other request so the client never hangs; ignore notifications.
  if (msg.id !== undefined && msg.method) send({ jsonrpc: '2.0', id: msg.id, result: null })
}
process.stdin.on('data', (d) => {
  buf = Buffer.concat([buf, d])
  while (true) {
    const headerEnd = buf.indexOf('\r\n\r\n')
    if (headerEnd === -1) break
    const header = buf.slice(0, headerEnd).toString()
    const m = header.match(/Content-Length: (\d+)/i)
    const start = headerEnd + 4
    if (!m) { buf = buf.slice(start); continue }
    const len = parseInt(m[1], 10)
    if (buf.length < start + len) break
    const body = buf.slice(start, start + len).toString()
    buf = buf.slice(start + len)
    try { handle(JSON.parse(body)) } catch {}
  }
})
`

let dir: string
let server: LSPServerDef

async function poll<T>(
  fn: () => T,
  ok: (v: T) => boolean,
  timeoutMs = 2000,
): Promise<T> {
  const start = Date.now()
  let last = fn()
  while (!ok(last) && Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 20))
    last = fn()
  }
  return last
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'lsp-mock-'))
  const mockPath = join(dir, 'mock-server.cjs')
  writeFileSync(mockPath, MOCK_SERVER)
  server = {
    id: 'mock',
    extensions: ['.ts'],
    // Run the mock with the current runtime (bun or node); both execute plain JS.
    command: process.execPath,
    args: [mockPath],
    rootMarkers: ['tsconfig.json'],
  }
})

afterEach(() => {
  clearAllLSPDiagnostics()
})

afterAll(() => {
  // Best-effort: on Windows the just-killed mock process can briefly hold the
  // .cjs handle (EBUSY). Cleanup isn't part of what's under test, and the OS
  // reclaims the temp dir regardless — so swallow teardown errors.
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  } catch {
    // temp dir left for the OS to reap
  }
})

test('initializes, syncs a document, and round-trips a definition request', async () => {
  const client = await LSPClient.create(server, dir)
  try {
    const filePath = join(dir, 'sample.ts')
    writeFileSync(filePath, 'const x = 1\n')

    expect(client.isFileOpen(filePath)).toBe(false)
    const version = await client.sync(filePath, 'const x = 1\n')
    expect(version).toBe(0)
    expect(client.isFileOpen(filePath)).toBe(true)
    // A subsequent sync bumps the version (didChange).
    expect(await client.sync(filePath, 'const x = 2\n')).toBe(1)

    const uri = pathToFileURL(filePath).href
    const result = (await client.sendRequest('textDocument/definition', {
      textDocument: { uri },
      position: { line: 0, character: 6 },
    })) as Array<{ uri: string }>

    expect(Array.isArray(result)).toBe(true)
    expect(result[0]?.uri).toBe(uri)
    expect(client.isAlive()).toBe(true)
  } finally {
    client.shutdown()
  }
})

test('push diagnostics from the server land in LSPDiagnosticRegistry', async () => {
  const client = await LSPClient.create(server, dir)
  try {
    const filePath = join(dir, 'pushy.ts')
    writeFileSync(filePath, 'const y = 1\n')
    await client.sync(filePath, 'const y = 1\n')

    const sets = await poll(
      () => checkForLSPDiagnostics(),
      s => s.length > 0,
    )
    expect(sets.length).toBeGreaterThan(0)
    const mock = sets.find(s => s.serverName === 'mock')
    expect(mock).toBeDefined()
    expect(mock!.files[0]?.diagnostics.length).toBeGreaterThan(0)
  } finally {
    client.shutdown()
  }
})

test('waitForDiagnostics pulls diagnostics for pull-capable servers', async () => {
  const client = await LSPClient.create(server, dir)
  try {
    const filePath = join(dir, 'pully.ts')
    writeFileSync(filePath, 'const z = 1\n')
    const version = await client.sync(filePath, 'const z = 1\n')

    await client.waitForDiagnostics({
      path: filePath,
      version,
      mode: 'document',
      after: Date.now(),
    })

    // Merged push + pull diagnostics are reachable via the client and registry.
    const merged = client.diagnostics.get(filePath) ?? []
    expect(merged.length).toBeGreaterThan(0)
    expect(
      merged.some(d => (d as { message?: string }).message === 'pull problem'),
    ).toBe(true)
  } finally {
    client.shutdown()
  }
})
