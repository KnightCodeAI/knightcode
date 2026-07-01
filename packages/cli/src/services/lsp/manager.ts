// LSP server manager: the backend behind LSPTool and the file tools' sync
// notifications. Detects which language servers are installed (synchronously,
// via PATH) and manages one client per (server, workspace-root) pair, spawning
// them lazily.
//
// Lifecycle mirrors the reference opencode orchestrator
// (shenanigans/opencode/packages/opencode/src/lsp/lsp.ts): concurrent requests
// for the same (server, root) share one in-flight spawn (the `spawning` map),
// and a (server, root) that fails to spawn/initialize is remembered as `broken`
// so it is not retried on every keystroke.
//
// The file tools call changeFile/saveFile on every edit; those only update
// servers that are ALREADY running (editing never spawns one). A server starts
// only when the LSP tool is actually used (openFile / sendRequest). After a
// save, the manager kicks off a background waitForDiagnostics so freshly
// introduced problems land in LSPDiagnosticRegistry for the attachment layer.

import { getCwd } from '../../utils/cwd.js'
import { logForDebugging } from '../../utils/debug.js'
import { toError } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { LSPClient } from './client.js'
import {
  getAvailableServerIds,
  type LSPServerDef,
  resolveProjectRoot,
  resolveServersForFile,
} from './serverRegistry.js'

export type LSPServerManager = {
  changeFile(filePath: string, content: string): Promise<void>
  saveFile(filePath: string): Promise<void>
  isFileOpen(filePath: string): boolean
  openFile(filePath: string, content: string): Promise<void>
  sendRequest(filePath: string, method: string, params: unknown): Promise<unknown>
}

type InitStatus = 'not-started' | 'pending' | 'completed'

let status: InitStatus = 'not-started'
let availableServerIds: string[] = []

// Server-availability detection is synchronous (PATH scan, cached in
// serverRegistry), so initialization completes in one pass. The async
// initialize handshake happens per-client on first use, not here.
function ensureDetected(): void {
  if (status !== 'not-started') return
  availableServerIds = getAvailableServerIds()
  status = 'completed'
  logForDebugging(
    availableServerIds.length > 0
      ? `LSP: detected servers: ${availableServerIds.join(', ')}`
      : 'LSP: no language servers found on PATH',
  )
}

export function getInitializationStatus(): { status: string } {
  ensureDetected()
  return { status }
}

export function isLspConnected(): boolean {
  ensureDetected()
  return availableServerIds.length > 0
}

export async function waitForInitialization(): Promise<void> {
  ensureDetected()
}

class Manager implements LSPServerManager {
  // Keyed by `${serverId}::${root}`.
  private readonly clients = new Map<string, LSPClient>()
  private readonly spawning = new Map<string, Promise<LSPClient | undefined>>()
  private readonly broken = new Set<string>()

  private keyFor(serverId: string, root: string): string {
    return `${serverId}::${root}`
  }

  private serversForFile(filePath: string): LSPServerDef[] {
    return resolveServersForFile(filePath).filter(s =>
      availableServerIds.includes(s.id),
    )
  }

  /**
   * Spawns and initializes a client for a (server, root), deduplicating
   * concurrent requests and remembering failures so they are not retried.
   */
  private ensureClient(
    server: LSPServerDef,
    root: string,
  ): Promise<LSPClient | undefined> {
    const key = this.keyFor(server.id, root)

    const existing = this.clients.get(key)
    if (existing) {
      if (existing.isAlive()) return Promise.resolve(existing)
      this.clients.delete(key)
    }
    if (this.broken.has(key)) return Promise.resolve(undefined)

    const inflight = this.spawning.get(key)
    if (inflight) return inflight

    const task = LSPClient.create(server, root)
      .then(client => {
        this.clients.set(key, client)
        logForDebugging(`LSP: started ${server.id} at ${root}`)
        return client
      })
      .catch(err => {
        this.broken.add(key)
        logForDebugging(`LSP: ${server.id} failed to start at ${root}`)
        logError(toError(err))
        return undefined
      })
    this.spawning.set(key, task)
    void task.finally(() => {
      if (this.spawning.get(key) === task) this.spawning.delete(key)
    })
    return task
  }

  /** Resolves the clients for a file, optionally spawning missing ones. */
  private async getClients(
    filePath: string,
    create: boolean,
  ): Promise<LSPClient[]> {
    const out: LSPClient[] = []
    const cwd = getCwd()
    for (const server of this.serversForFile(filePath)) {
      const root = resolveProjectRoot(filePath, server, cwd)
      const existing = this.clients.get(this.keyFor(server.id, root))
      if (existing?.isAlive()) {
        out.push(existing)
        continue
      }
      if (!create) continue
      const client = await this.ensureClient(server, root)
      if (client) out.push(client)
    }
    return out
  }

  isFileOpen(filePath: string): boolean {
    const cwd = getCwd()
    for (const server of this.serversForFile(filePath)) {
      const root = resolveProjectRoot(filePath, server, cwd)
      const client = this.clients.get(this.keyFor(server.id, root))
      if (client?.isAlive() && client.isFileOpen(filePath)) return true
    }
    return false
  }

  async openFile(filePath: string, content: string): Promise<void> {
    const clients = await this.getClients(filePath, true)
    await Promise.all(clients.map(c => c.sync(filePath, content)))
  }

  async changeFile(filePath: string, content: string): Promise<void> {
    // Sync only servers that are already running; never spawn on an edit.
    const clients = await this.getClients(filePath, false)
    await Promise.all(clients.map(c => c.sync(filePath, content)))
  }

  async saveFile(filePath: string): Promise<void> {
    const clients = await this.getClients(filePath, false)
    const after = Date.now()
    await Promise.all(
      clients.map(async client => {
        await client.didSave(filePath)
        // Surface freshly-introduced problems in the background — the file tool
        // does not await this, and results flow into LSPDiagnosticRegistry.
        const version = client.getVersion(filePath) ?? 0
        void client
          .waitForDiagnostics({ path: filePath, version, mode: 'document', after })
          .catch(() => {})
      }),
    )
  }

  async sendRequest(
    filePath: string,
    method: string,
    params: unknown,
  ): Promise<unknown> {
    const [primary] = await this.getClients(filePath, true)
    if (!primary) return undefined
    // The tool's request schema expects a single server's result; route to the
    // primary server for the file's language (registry order).
    return primary.sendRequest(method, params)
  }

  shutdownAll(): void {
    for (const client of this.clients.values()) client.shutdown()
    this.clients.clear()
    this.spawning.clear()
    this.broken.clear()
  }
}

let manager: Manager | undefined
let exitHandlerRegistered = false

/**
 * Returns the manager, or undefined when no language servers are installed
 * (so the file tools skip LSP work entirely). The LSP tool's isEnabled() gate
 * (isLspConnected) keeps it hidden in that case too.
 */
export function getLspServerManager(): LSPServerManager | undefined {
  if (!isLspConnected()) return undefined
  if (!manager) {
    manager = new Manager()
    if (!exitHandlerRegistered) {
      exitHandlerRegistered = true
      const shutdown = () => manager?.shutdownAll()
      process.once('exit', shutdown)
      process.once('SIGINT', shutdown)
      process.once('SIGTERM', shutdown)
    }
  }
  return manager
}

/** Test seam: tears down clients and resets detection state. */
export function resetLspManagerForTest(): void {
  manager?.shutdownAll()
  manager = undefined
  status = 'not-started'
  availableServerIds = []
}
