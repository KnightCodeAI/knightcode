// A single language-server client: owns one child process and the JSON-RPC
// connection to it, and tracks the full diagnostic lifecycle for that server.
//
// This is a faithful port of the reference opencode client
// (shenanigans/opencode/packages/opencode/src/lsp/client.ts), adapted off
// opencode's Effect/Bus runtime onto plain promises and node APIs, and wired to
// feed knightcode's LSPDiagnosticRegistry. It implements both diagnostic
// transports the modern servers use:
//
//   - PUSH: textDocument/publishDiagnostics notifications.
//   - PULL: textDocument/diagnostic and workspace/diagnostic requests, gated on
//     either a static diagnosticProvider capability or a dynamic
//     client/registerCapability for textDocument/diagnostic.
//
// waitForDiagnostics() races a debounced fresh-push signal against active pulls
// so the manager can surface "new problems after an edit" deterministically.

import { type ChildProcess, spawn } from 'child_process'
import { fileURLToPath, pathToFileURL } from 'url'
import {
  createMessageConnection,
  type MessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node'
import type { Diagnostic } from 'vscode-languageserver-types'
import { logForDebugging } from '../../utils/debug.js'
import { toError } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { sleep } from '../../utils/sleep.js'
import { subprocessEnv } from '../../utils/subprocessEnv.js'
import { languageIdForFile } from './languageIds.js'
import { recordDiagnostics } from './LSPDiagnosticRegistry.js'
import { findServerBinary, type LSPServerDef } from './serverRegistry.js'

const INITIALIZE_TIMEOUT_MS = 30_000
// LSP error code: the server's state changed mid-request (e.g. rust-analyzer
// still indexing). Transient — the spec says clients should retry silently.
const LSP_ERROR_CONTENT_MODIFIED = -32801
const MAX_TRANSIENT_RETRIES = 3
const RETRY_BASE_DELAY_MS = 500
const DIAGNOSTICS_DEBOUNCE_MS = 150
const DIAGNOSTICS_DOCUMENT_WAIT_TIMEOUT_MS = 5_000
const DIAGNOSTICS_FULL_WAIT_TIMEOUT_MS = 10_000
const DIAGNOSTICS_REQUEST_TIMEOUT_MS = 3_000

// LSP spec constants.
const FILE_CHANGE_CREATED = 1
const FILE_CHANGE_CHANGED = 2
const TEXT_DOCUMENT_SYNC_INCREMENTAL = 2

type CapabilityRegistration = {
  id: string
  method: string
  registerOptions?: { identifier?: string; workspaceDiagnostics?: boolean }
}

type ServerCapabilities = {
  textDocumentSync?: number | { change?: number }
  diagnosticProvider?: unknown
  [key: string]: unknown
}

type DocumentDiagnosticReport = {
  items?: Diagnostic[]
  relatedDocuments?: Record<string, DocumentDiagnosticReport>
}

type WorkspaceDiagnosticReport = {
  items?: { uri?: string; items?: Diagnostic[] }[]
}

type DiagnosticRequestResult = {
  handled: boolean
  matched: boolean
  byFile: Map<string, Diagnostic[]>
}

export type DiagnosticMode = 'document' | 'full'

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    )
    p.then(
      v => {
        clearTimeout(timer)
        resolve(v)
      },
      e => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

/** file:// URI -> absolute path, or undefined for non-file URIs. */
function uriToPath(uri: string): string | undefined {
  if (!uri.startsWith('file://')) return undefined
  try {
    return fileURLToPath(uri)
  } catch {
    return undefined
  }
}

function getSyncKind(capabilities?: ServerCapabilities): number | undefined {
  const sync = capabilities?.textDocumentSync
  if (typeof sync === 'number') return sync
  return sync?.change
}

function endPosition(text: string): { line: number; character: number } {
  const lines = text.split(/\r\n|\r|\n/)
  return { line: lines.length - 1, character: lines.at(-1)?.length ?? 0 }
}

function dedupeDiagnostics(items: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>()
  return items.filter(item => {
    const key = JSON.stringify({
      code: item.code,
      severity: item.severity,
      message: item.message,
      source: item.source,
      range: item.range,
    })
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function configurationValue(settings: unknown, section?: string): unknown {
  if (!section) return settings ?? null
  const result = section.split('.').reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== 'object' || !(key in acc)) return undefined
    return (acc as Record<string, unknown>)[key]
  }, settings)
  return result ?? null
}

// TypeScript's server pushes diagnostics aggressively on first open. Seed the
// push cache on the very first publish so waitForFreshPush can resolve without
// waiting for a second debounced push.
function shouldSeedDiagnosticsOnFirstPush(serverId: string): boolean {
  return serverId === 'typescript'
}

export class LSPClient {
  readonly serverId: string
  readonly root: string
  private readonly proc: ChildProcess
  private readonly connection: MessageConnection
  private readonly initialization?: Record<string, unknown>

  private readonly files = new Map<string, { version: number; text: string }>()
  private readonly pushDiagnostics = new Map<string, Diagnostic[]>()
  private readonly pullDiagnostics = new Map<string, Diagnostic[]>()
  private readonly published = new Map<
    string,
    { at: number; version?: number }
  >()
  private readonly diagnosticRegistrations = new Map<
    string,
    CapabilityRegistration
  >()
  private readonly registrationListeners = new Set<() => void>()
  private readonly diagnosticListeners = new Set<(path: string) => void>()

  private syncKind: number | undefined
  private hasStaticPullDiagnostics = false
  private alive = true
  private disposed = false

  private constructor(
    server: LSPServerDef,
    root: string,
    proc: ChildProcess,
    initialization: Record<string, unknown> | undefined,
  ) {
    this.serverId = server.id
    this.root = root
    this.proc = proc
    this.initialization = initialization

    if (!proc.stdout || !proc.stdin) {
      throw new Error(`LSP server ${server.id} has no stdio pipes`)
    }

    this.connection = createMessageConnection(
      new StreamMessageReader(proc.stdout),
      new StreamMessageWriter(proc.stdin),
    )

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim()
      if (text) logForDebugging(`[lsp:${server.id}] ${text.slice(0, 500)}`)
    })
    proc.on('exit', code => {
      this.alive = false
      logForDebugging(`[lsp:${server.id}] server exited (code ${code})`)
    })
    proc.on('error', err => {
      this.alive = false
      logError(toError(err))
    })
    // stdin can error if the server dies mid-write; swallow to avoid unhandled
    // rejections (the connection close/error handlers below own the failure).
    proc.stdin.on('error', () => {})

    // Connection-level errors (JSON-RPC framing) and close are surfaced here, not
    // just via proc events — a wedged connection marks the client dead so the
    // manager respawns on next use.
    this.connection.onError(() => {
      if (!this.disposed) this.alive = false
    })
    this.connection.onClose(() => {
      if (!this.disposed) this.alive = false
    })

    this.registerHandlers()
    this.connection.listen()
  }

  /**
   * Spawns the server, runs the initialize/initialized handshake, and returns a
   * ready client. Throws if the binary is missing, spawn fails, or initialize
   * times out (the manager records the (server,root) as broken on throw).
   */
  static async create(
    server: LSPServerDef,
    root: string,
  ): Promise<LSPClient> {
    const bin = findServerBinary(server)
    if (!bin) throw new Error(`LSP server binary not found: ${server.command}`)

    // On Windows, npm-installed CLIs resolve to .cmd/.bat shims that
    // child_process.spawn cannot execute directly — they must run via the shell.
    const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)
    const proc = spawn(needsShell ? `"${bin}"` : bin, server.args, {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: needsShell,
      // subprocessEnv() strips telemetry/proxy vars the server shouldn't inherit.
      env: subprocessEnv(),
      windowsHide: true,
    })

    // spawn() returns synchronously, but failures (ENOENT for a missing binary)
    // arrive asynchronously as an 'error' event. Wait for 'spawn' before using
    // the streams so a bad binary fails fast here instead of hanging the
    // initialize request until its 30s timeout.
    await new Promise<void>((resolve, reject) => {
      const onSpawn = () => {
        cleanup()
        resolve()
      }
      const onError = (err: Error) => {
        cleanup()
        reject(err)
      }
      const cleanup = () => {
        proc.removeListener('spawn', onSpawn)
        proc.removeListener('error', onError)
      }
      proc.once('spawn', onSpawn)
      proc.once('error', onError)
    })

    const initialization = server.initialization?.(root)
    const client = new LSPClient(server, root, proc, initialization)
    try {
      await client.handshake()
    } catch (err) {
      client.shutdown()
      throw err
    }
    return client
  }

  private registerHandlers(): void {
    this.connection.onNotification(
      'textDocument/publishDiagnostics',
      (params: { uri?: string; diagnostics?: Diagnostic[]; version?: number }) => {
        const filePath = params?.uri ? uriToPath(params.uri) : undefined
        if (!filePath) return
        this.published.set(filePath, {
          at: Date.now(),
          version: typeof params.version === 'number' ? params.version : undefined,
        })
        const diags = params.diagnostics ?? []
        // Seed (don't broadcast) the very first TypeScript push so the debounce
        // waiter sees a baseline immediately.
        if (
          shouldSeedDiagnosticsOnFirstPush(this.serverId) &&
          !this.pushDiagnostics.has(filePath)
        ) {
          this.pushDiagnostics.set(filePath, diags)
          this.reportToRegistry(filePath)
          return
        }
        this.updatePushDiagnostics(filePath, diags)
      },
    )

    this.connection.onRequest(
      'workspace/configuration',
      (params: { items?: { section?: string }[] }) =>
        (params?.items ?? []).map(item =>
          configurationValue(this.initialization, item.section),
        ),
    )
    this.connection.onRequest('window/workDoneProgress/create', () => null)
    this.connection.onRequest('workspace/workspaceFolders', () => [
      { name: 'workspace', uri: pathToFileURL(this.root).href },
    ])
    this.connection.onRequest('workspace/diagnostic/refresh', () => null)
    this.connection.onRequest(
      'client/registerCapability',
      (params: { registrations?: CapabilityRegistration[] }) => {
        let changed = false
        for (const reg of params?.registrations ?? []) {
          if (reg.method !== 'textDocument/diagnostic') continue
          this.diagnosticRegistrations.set(reg.id, reg)
          changed = true
        }
        if (changed) this.emitRegistrationChange()
        return null
      },
    )
    this.connection.onRequest(
      'client/unregisterCapability',
      (params: { unregisterations?: { id: string; method: string }[] }) => {
        let changed = false
        for (const reg of params?.unregisterations ?? []) {
          if (reg.method !== 'textDocument/diagnostic') continue
          this.diagnosticRegistrations.delete(reg.id)
          changed = true
        }
        if (changed) this.emitRegistrationChange()
        return null
      },
    )
  }

  private async handshake(): Promise<void> {
    const rootUri = pathToFileURL(this.root).href
    const initialized = await withTimeout(
      this.connection.sendRequest<{ capabilities?: ServerCapabilities }>(
        'initialize',
        {
          processId: process.pid,
          rootUri,
          workspaceFolders: [{ name: 'workspace', uri: rootUri }],
          initializationOptions: { ...this.initialization },
          capabilities: {
            window: { workDoneProgress: true },
            workspace: {
              configuration: true,
              workspaceFolders: true,
              didChangeWatchedFiles: { dynamicRegistration: true },
              diagnostics: { refreshSupport: false },
            },
            textDocument: {
              synchronization: {
                didOpen: true,
                didChange: true,
                didSave: true,
              },
              diagnostic: {
                dynamicRegistration: true,
                relatedDocumentSupport: true,
              },
              publishDiagnostics: { versionSupport: false },
              definition: { linkSupport: true },
              implementation: { linkSupport: true },
              references: {},
              hover: { contentFormat: ['markdown', 'plaintext'] },
              documentSymbol: { hierarchicalDocumentSymbolSupport: true },
              callHierarchy: { dynamicRegistration: false },
            },
          },
        },
      ),
      INITIALIZE_TIMEOUT_MS,
      `LSP ${this.serverId} initialize`,
    )

    this.syncKind = getSyncKind(initialized.capabilities)
    this.hasStaticPullDiagnostics = Boolean(
      initialized.capabilities?.diagnosticProvider,
    )

    await this.connection.sendNotification('initialized', {})
    if (this.initialization) {
      await this.connection.sendNotification('workspace/didChangeConfiguration', {
        settings: this.initialization,
      })
    }
  }

  // --- diagnostic bookkeeping ---

  private mergedDiagnostics(filePath: string): Diagnostic[] {
    return dedupeDiagnostics([
      ...(this.pushDiagnostics.get(filePath) ?? []),
      ...(this.pullDiagnostics.get(filePath) ?? []),
    ])
  }

  private reportToRegistry(filePath: string): void {
    recordDiagnostics(
      this.serverId,
      pathToFileURL(filePath).href,
      this.mergedDiagnostics(filePath),
    )
  }

  private updatePushDiagnostics(filePath: string, next: Diagnostic[]): void {
    this.pushDiagnostics.set(filePath, next)
    this.reportToRegistry(filePath)
    for (const listener of [...this.diagnosticListeners]) listener(filePath)
  }

  private updatePullDiagnostics(filePath: string, next: Diagnostic[]): void {
    this.pullDiagnostics.set(filePath, next)
    this.reportToRegistry(filePath)
  }

  private emitRegistrationChange(): void {
    for (const listener of [...this.registrationListeners]) listener()
  }

  // --- document sync ---

  isFileOpen(filePath: string): boolean {
    return this.files.has(filePath)
  }

  getVersion(filePath: string): number | undefined {
    return this.files.get(filePath)?.version
  }

  /**
   * Syncs a document to the server: didOpen the first time, didChange (with
   * watched-file notification) afterwards. Returns the document's new version.
   */
  async sync(filePath: string, text: string): Promise<number> {
    const document = this.files.get(filePath)
    const uri = pathToFileURL(filePath).href

    if (document !== undefined) {
      await this.connection.sendNotification('workspace/didChangeWatchedFiles', {
        changes: [{ uri, type: FILE_CHANGE_CHANGED }],
      })
      const next = document.version + 1
      await this.connection.sendNotification('textDocument/didChange', {
        textDocument: { uri, version: next },
        contentChanges:
          this.syncKind === TEXT_DOCUMENT_SYNC_INCREMENTAL
            ? [
                {
                  range: {
                    start: { line: 0, character: 0 },
                    end: endPosition(document.text),
                  },
                  text,
                },
              ]
            : [{ text }],
      })
      this.files.set(filePath, { version: next, text })
      return next
    }

    await this.connection.sendNotification('workspace/didChangeWatchedFiles', {
      changes: [{ uri, type: FILE_CHANGE_CREATED }],
    })
    // Fresh open: drop any stale diagnostics so the server's push is treated as new.
    this.pushDiagnostics.delete(filePath)
    this.pullDiagnostics.delete(filePath)
    await this.connection.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: languageIdForFile(filePath),
        version: 0,
        text,
      },
    })
    this.files.set(filePath, { version: 0, text })
    return 0
  }

  async didSave(filePath: string): Promise<void> {
    if (!this.files.has(filePath)) return
    await this.connection.sendNotification('textDocument/didSave', {
      textDocument: { uri: pathToFileURL(filePath).href },
    })
  }

  async sendRequest(method: string, params: unknown): Promise<unknown> {
    // Retry transient "content modified" errors (e.g. rust-analyzer indexing)
    // with exponential backoff, per the LSP spec. Duck-type the code rather
    // than instanceof — multiple vscode-jsonrpc versions can coexist.
    let lastError: unknown
    for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
      try {
        return await this.connection.sendRequest(method, params)
      } catch (error) {
        lastError = error
        const code = (error as { code?: number }).code
        if (code === LSP_ERROR_CONTENT_MODIFIED && attempt < MAX_TRANSIENT_RETRIES) {
          await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt)
          continue
        }
        throw error
      }
    }
    throw lastError
  }

  get diagnostics(): Map<string, Diagnostic[]> {
    const result = new Map<string, Diagnostic[]>()
    for (const key of new Set([
      ...this.pushDiagnostics.keys(),
      ...this.pullDiagnostics.keys(),
    ])) {
      result.set(key, this.mergedDiagnostics(key))
    }
    return result
  }

  // --- pull diagnostics ---

  private async requestDiagnosticReport(
    filePath: string,
    identifier?: string,
  ): Promise<DiagnosticRequestResult> {
    const empty: DiagnosticRequestResult = {
      handled: false,
      matched: false,
      byFile: new Map(),
    }
    const report = await withTimeout(
      this.connection.sendRequest<DocumentDiagnosticReport | null>(
        'textDocument/diagnostic',
        {
          ...(identifier ? { identifier } : {}),
          textDocument: { uri: pathToFileURL(filePath).href },
        },
      ),
      DIAGNOSTICS_REQUEST_TIMEOUT_MS,
      'textDocument/diagnostic',
    ).catch(() => null)
    if (!report) return empty

    const byFile = new Map<string, Diagnostic[]>()
    const push = (target: string, items: Diagnostic[]) => {
      byFile.set(target, (byFile.get(target) ?? []).concat(items))
    }
    let handled = false
    let matched = false
    if (Array.isArray(report.items)) {
      push(filePath, report.items)
      handled = true
      matched = true
    }
    for (const [uri, related] of Object.entries(report.relatedDocuments ?? {})) {
      const relatedPath = uriToPath(uri)
      if (!relatedPath || !Array.isArray(related.items)) continue
      push(relatedPath, related.items)
      handled = true
      matched = matched || relatedPath === filePath
    }
    return { handled, matched, byFile }
  }

  private async requestWorkspaceDiagnosticReport(
    filePath: string,
    identifier?: string,
  ): Promise<DiagnosticRequestResult> {
    const empty: DiagnosticRequestResult = {
      handled: false,
      matched: false,
      byFile: new Map(),
    }
    const report = await withTimeout(
      this.connection.sendRequest<WorkspaceDiagnosticReport | null>(
        'workspace/diagnostic',
        { ...(identifier ? { identifier } : {}), previousResultIds: [] },
      ),
      DIAGNOSTICS_REQUEST_TIMEOUT_MS,
      'workspace/diagnostic',
    ).catch(() => null)
    if (!report) return empty

    const byFile = new Map<string, Diagnostic[]>()
    let matched = false
    for (const item of report.items ?? []) {
      const relatedPath = item.uri ? uriToPath(item.uri) : undefined
      if (!relatedPath || !Array.isArray(item.items)) continue
      byFile.set(relatedPath, (byFile.get(relatedPath) ?? []).concat(item.items))
      matched = matched || relatedPath === filePath
    }
    return { handled: true, matched, byFile }
  }

  private documentPullState(): { identifiers: string[]; supported: boolean } {
    const regs = [...this.diagnosticRegistrations.values()].filter(
      r => r.registerOptions?.workspaceDiagnostics !== true,
    )
    return {
      identifiers: [
        ...new Set(regs.flatMap(r => r.registerOptions?.identifier ?? [])),
      ],
      supported: this.hasStaticPullDiagnostics || regs.length > 0,
    }
  }

  private workspacePullState(): { identifiers: string[]; supported: boolean } {
    const regs = [...this.diagnosticRegistrations.values()].filter(
      r => r.registerOptions?.workspaceDiagnostics === true,
    )
    return {
      identifiers: [
        ...new Set(regs.flatMap(r => r.registerOptions?.identifier ?? [])),
      ],
      supported: regs.length > 0,
    }
  }

  private mergeResults(
    filePath: string,
    results: DiagnosticRequestResult[],
  ): { handled: boolean; matched: boolean } {
    const handled = results.some(r => r.handled)
    const matched = results.some(r => r.matched)
    if (!handled) return { handled: false, matched: false }

    const merged = new Map<string, Diagnostic[]>()
    for (const result of results) {
      for (const [target, items] of result.byFile.entries()) {
        merged.set(target, (merged.get(target) ?? []).concat(items))
      }
    }
    if (matched && !merged.has(filePath)) merged.set(filePath, [])
    for (const [target, items] of merged.entries()) {
      this.updatePullDiagnostics(target, dedupeDiagnostics(items))
    }
    return { handled, matched }
  }

  private async requestDocumentDiagnostics(
    filePath: string,
  ): Promise<{ handled: boolean; matched: boolean }> {
    const state = this.documentPullState()
    if (!state.supported) return { handled: false, matched: false }
    const results = await Promise.all([
      this.requestDiagnosticReport(filePath),
      ...state.identifiers.map(id => this.requestDiagnosticReport(filePath, id)),
    ])
    return this.mergeResults(filePath, results)
  }

  private async requestFullDiagnostics(
    filePath: string,
  ): Promise<{ handled: boolean; matched: boolean }> {
    const doc = this.documentPullState()
    const ws = this.workspacePullState()
    if (!doc.supported && !ws.supported) return { handled: false, matched: false }
    const results = await Promise.all([
      ...(doc.supported ? [this.requestDiagnosticReport(filePath)] : []),
      ...doc.identifiers.map(id => this.requestDiagnosticReport(filePath, id)),
      ...(ws.supported ? [this.requestWorkspaceDiagnosticReport(filePath)] : []),
      ...ws.identifiers.map(id =>
        this.requestWorkspaceDiagnosticReport(filePath, id),
      ),
    ])
    return this.mergeResults(filePath, results)
  }

  private waitForRegistrationChange(timeout: number): Promise<boolean> {
    if (timeout <= 0) return Promise.resolve(false)
    return new Promise<boolean>(resolve => {
      let done = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (result: boolean) => {
        if (done) return
        done = true
        if (timer) clearTimeout(timer)
        this.registrationListeners.delete(listener)
        resolve(result)
      }
      const listener = () => finish(true)
      this.registrationListeners.add(listener)
      timer = setTimeout(() => finish(false), timeout)
    })
  }

  private waitForFreshPush(request: {
    path: string
    version: number
    after: number
    timeout: number
  }): Promise<boolean> {
    if (request.timeout <= 0) return Promise.resolve(false)
    return new Promise<boolean>(resolve => {
      let done = false
      let debounce: ReturnType<typeof setTimeout> | undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (result: boolean) => {
        if (done) return
        done = true
        if (debounce) clearTimeout(debounce)
        if (timer) clearTimeout(timer)
        this.diagnosticListeners.delete(listener)
        resolve(result)
      }
      const schedule = () => {
        const hit = this.published.get(request.path)
        if (!hit) return
        if (typeof hit.version === 'number' && hit.version !== request.version)
          return
        if (hit.at < request.after && hit.version !== request.version) return
        if (debounce) clearTimeout(debounce)
        debounce = setTimeout(
          () => finish(true),
          Math.max(0, DIAGNOSTICS_DEBOUNCE_MS - (Date.now() - hit.at)),
        )
      }
      const listener = (path: string) => {
        if (path === request.path) schedule()
      }
      timer = setTimeout(() => finish(false), request.timeout)
      this.diagnosticListeners.add(listener)
      schedule()
    })
  }

  /**
   * Waits until the server has produced diagnostics for the file at the given
   * version: a debounced fresh push, or (for pull-capable servers) a pull that
   * returns results. Resolves on timeout regardless so callers never hang.
   */
  async waitForDiagnostics(request: {
    path: string
    version: number
    mode?: DiagnosticMode
    after?: number
  }): Promise<void> {
    const startedAt = request.after ?? Date.now()
    const isDocument = request.mode === 'document'
    const timeout = isDocument
      ? DIAGNOSTICS_DOCUMENT_WAIT_TIMEOUT_MS
      : DIAGNOSTICS_FULL_WAIT_TIMEOUT_MS
    const pushWait = this.waitForFreshPush({
      path: request.path,
      version: request.version,
      after: startedAt,
      timeout,
    })

    while (Date.now() - startedAt < timeout) {
      const result = isDocument
        ? await this.requestDocumentDiagnostics(request.path)
        : await this.requestFullDiagnostics(request.path)
      if (isDocument ? result.matched : result.handled || result.matched) return
      const remaining = timeout - (Date.now() - startedAt)
      if (remaining <= 0) return
      const next = await Promise.race([
        pushWait.then(ready => (ready ? 'push' : ('timeout' as const))),
        this.waitForRegistrationChange(remaining).then(changed =>
          changed ? 'registration' : ('timeout' as const),
        ),
      ])
      if (next !== 'registration') return
    }
  }

  isAlive(): boolean {
    return this.alive && !this.disposed
  }

  shutdown(): void {
    if (this.disposed) return
    this.disposed = true
    // Best-effort graceful exit: ask the server to shut down before we kill it,
    // so it can flush/clean up. Fire-and-forget — shutdown() runs on process
    // exit handlers (sync), so we can't await; the kill below is the backstop.
    try {
      void this.connection.sendNotification('exit', {}).catch(() => {})
    } catch {
      // connection may already be down
    }
    try {
      this.connection.dispose()
    } catch {
      // already torn down
    }
    try {
      this.proc.kill()
    } catch {
      // already gone
    }
  }
}
