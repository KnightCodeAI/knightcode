/**
 * MCP subcommand handlers — the BYOK-relevant subset of `knightcode mcp *`.
 *
 * Lazily imported by cli/mcpCommand.ts only when the corresponding subcommand
 * runs. The cloud/SDK-only handlers (`serve`, the desktop-app import, the XAA
 * enterprise IdP flow) are intentionally not ported.
 */

import {
  clearMcpClientConfig,
  clearServerTokensFromLocalStorage,
  getMcpClientConfig,
  readClientSecret,
  saveMcpClientSecret,
} from '../../services/mcp/auth.js'
import {
  connectToServer,
  getMcpServerConnectionBatchSize,
} from '../../services/mcp/client.js'
import {
  addMcpConfig,
  getAllMcpConfigs,
  getMcpConfigByName,
  getMcpConfigsByScope,
  removeMcpConfig,
} from '../../services/mcp/config.js'
import type { ConfigScope, ScopedMcpServerConfig } from '../../services/mcp/types.js'
import {
  describeMcpConfigFilePath,
  ensureConfigScope,
  getScopeLabel,
} from '../../services/mcp/utils.js'
import { getCurrentProjectConfig, getGlobalConfig } from '../../utils/config.js'
import { saveCurrentProjectConfig } from '../../utils/config.js'
import { gracefulShutdown } from '../../utils/gracefulShutdown.js'
import { safeParseJSONC } from '../../utils/json.js'
import { cliError, cliOk } from '../exit.js'

/** Run `mapper` over `items` with at most `concurrency` in flight at once. */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (next < items.length) {
        const i = next++
        results[i] = await mapper(items[i]!)
      }
    },
  )
  await Promise.all(workers)
  return results
}

async function checkMcpServerHealth(
  name: string,
  server: ScopedMcpServerConfig,
): Promise<string> {
  try {
    const result = await connectToServer(name, server)
    if (result.type === 'connected') {
      return '✓ Connected'
    } else if (result.type === 'needs-auth') {
      return '! Needs authentication'
    } else {
      return '✗ Failed to connect'
    }
  } catch (_error) {
    return '✗ Connection error'
  }
}

// knightcode mcp remove <name> [-s scope]
export async function mcpRemoveHandler(
  name: string,
  options: { scope?: string },
): Promise<void> {
  // Look up config before removing so we can clean up secure storage
  const serverBeforeRemoval = getMcpConfigByName(name)
  const cleanupSecureStorage = () => {
    if (
      serverBeforeRemoval &&
      (serverBeforeRemoval.type === 'sse' || serverBeforeRemoval.type === 'http')
    ) {
      clearServerTokensFromLocalStorage(name, serverBeforeRemoval)
      clearMcpClientConfig(name, serverBeforeRemoval)
    }
  }
  try {
    if (options.scope) {
      const scope = ensureConfigScope(options.scope)
      await removeMcpConfig(name, scope)
      cleanupSecureStorage()
      process.stdout.write(`Removed MCP server ${name} from ${scope} config\n`)
      cliOk(`File modified: ${describeMcpConfigFilePath(scope)}`)
    }

    // If no scope specified, check where the server exists
    const projectConfig = getCurrentProjectConfig()
    const globalConfig = getGlobalConfig()

    // Check if server exists in project scope (.mcp.json)
    const { servers: projectServers } = getMcpConfigsByScope('project')
    const mcpJsonExists = !!projectServers[name]

    // Count how many scopes contain this server
    const scopes: Array<Exclude<ConfigScope, 'dynamic'>> = []
    if (projectConfig.mcpServers?.[name]) scopes.push('local')
    if (mcpJsonExists) scopes.push('project')
    if (globalConfig.mcpServers?.[name]) scopes.push('user')
    if (scopes.length === 0) {
      cliError(`No MCP server found with name: "${name}"`)
    } else if (scopes.length === 1) {
      // Server exists in only one scope, remove it
      const scope = scopes[0]!
      await removeMcpConfig(name, scope)
      cleanupSecureStorage()
      process.stdout.write(`Removed MCP server "${name}" from ${scope} config\n`)
      cliOk(`File modified: ${describeMcpConfigFilePath(scope)}`)
    } else {
      // Server exists in multiple scopes
      process.stderr.write(`MCP server "${name}" exists in multiple scopes:\n`)
      scopes.forEach(scope => {
        process.stderr.write(
          `  - ${getScopeLabel(scope)} (${describeMcpConfigFilePath(scope)})\n`,
        )
      })
      process.stderr.write('\nTo remove from a specific scope, use:\n')
      scopes.forEach(scope => {
        process.stderr.write(`  knightcode mcp remove "${name}" -s ${scope}\n`)
      })
      cliError()
    }
  } catch (error) {
    cliError((error as Error).message)
  }
}

// knightcode mcp list
export async function mcpListHandler(): Promise<void> {
  const { servers: configs } = await getAllMcpConfigs()
  if (Object.keys(configs).length === 0) {
    process.stdout.write(
      'No MCP servers configured. Use `knightcode mcp add` to add a server.\n',
    )
  } else {
    process.stdout.write('Checking MCP server health...\n\n')

    // Check servers concurrently
    const entries = Object.entries(configs)
    const results = await mapWithConcurrency(
      entries,
      getMcpServerConnectionBatchSize(),
      async ([name, server]) => ({
        name,
        server,
        status: await checkMcpServerHealth(name, server),
      }),
    )
    for (const { name, server, status } of results) {
      // Intentionally excluding sse-ide servers here since they're internal
      if (server.type === 'sse') {
        process.stdout.write(`${name}: ${server.url} (SSE) - ${status}\n`)
      } else if (server.type === 'http') {
        process.stdout.write(`${name}: ${server.url} (HTTP) - ${status}\n`)
      } else if (!server.type || server.type === 'stdio') {
        const args = Array.isArray(server.args) ? server.args : []
        process.stdout.write(
          `${name}: ${server.command} ${args.join(' ')} - ${status}\n`,
        )
      }
    }
  }
  // Use gracefulShutdown to properly clean up MCP server connections
  // (process.exit bypasses cleanup handlers, leaving child processes orphaned)
  await gracefulShutdown(0)
}

// knightcode mcp get <name>
export async function mcpGetHandler(name: string): Promise<void> {
  const server = getMcpConfigByName(name)
  if (!server) {
    cliError(`No MCP server found with name: ${name}`)
  }

  process.stdout.write(`${name}:\n`)
  process.stdout.write(`  Scope: ${getScopeLabel(server.scope)}\n`)

  // Check server health
  const status = await checkMcpServerHealth(name, server)
  process.stdout.write(`  Status: ${status}\n`)

  if (server.type === 'sse' || server.type === 'http') {
    process.stdout.write(`  Type: ${server.type}\n`)
    process.stdout.write(`  URL: ${server.url}\n`)
    if (server.headers) {
      process.stdout.write('  Headers:\n')
      for (const [key, value] of Object.entries(server.headers)) {
        process.stdout.write(`    ${key}: ${value}\n`)
      }
    }
    if (server.oauth?.clientId || server.oauth?.callbackPort) {
      const parts: string[] = []
      if (server.oauth.clientId) {
        parts.push('client_id configured')
        const clientConfig = getMcpClientConfig(name, server)
        if (clientConfig?.clientSecret) parts.push('client_secret configured')
      }
      if (server.oauth.callbackPort) {
        parts.push(`callback_port ${server.oauth.callbackPort}`)
      }
      process.stdout.write(`  OAuth: ${parts.join(', ')}\n`)
    }
  } else if (server.type === 'stdio') {
    process.stdout.write(`  Type: stdio\n`)
    process.stdout.write(`  Command: ${server.command}\n`)
    const args = Array.isArray(server.args) ? server.args : []
    process.stdout.write(`  Args: ${args.join(' ')}\n`)
    if (server.env) {
      process.stdout.write('  Environment:\n')
      for (const [key, value] of Object.entries(server.env)) {
        process.stdout.write(`    ${key}=${value}\n`)
      }
    }
  }
  process.stdout.write(
    `\nTo remove this server, run: knightcode mcp remove "${name}" -s ${server.scope}\n`,
  )
  // Use gracefulShutdown to properly clean up MCP server connections
  await gracefulShutdown(0)
}

// knightcode mcp add-json <name> <json>
export async function mcpAddJsonHandler(
  name: string,
  json: string,
  options: { scope?: string; clientSecret?: true },
): Promise<void> {
  try {
    const scope = ensureConfigScope(options.scope)
    const parsedJson = safeParseJSONC(json)

    // Read secret before writing config so cancellation doesn't leave partial
    // state.
    const needsSecret =
      options.clientSecret &&
      parsedJson &&
      typeof parsedJson === 'object' &&
      'type' in parsedJson &&
      (parsedJson.type === 'sse' || parsedJson.type === 'http') &&
      'url' in parsedJson &&
      typeof parsedJson.url === 'string' &&
      'oauth' in parsedJson &&
      parsedJson.oauth &&
      typeof parsedJson.oauth === 'object' &&
      'clientId' in parsedJson.oauth
    const clientSecret = needsSecret ? await readClientSecret() : undefined
    await addMcpConfig(name, parsedJson, scope)
    const transportType =
      parsedJson && typeof parsedJson === 'object' && 'type' in parsedJson
        ? String(parsedJson.type || 'stdio')
        : 'stdio'
    if (
      clientSecret &&
      parsedJson &&
      typeof parsedJson === 'object' &&
      'type' in parsedJson &&
      (parsedJson.type === 'sse' || parsedJson.type === 'http') &&
      'url' in parsedJson &&
      typeof parsedJson.url === 'string'
    ) {
      saveMcpClientSecret(
        name,
        { type: parsedJson.type, url: parsedJson.url },
        clientSecret,
      )
    }
    cliOk(`Added ${transportType} MCP server ${name} to ${scope} config`)
  } catch (error) {
    cliError((error as Error).message)
  }
}

// knightcode mcp reset-project-choices
export async function mcpResetChoicesHandler(): Promise<void> {
  saveCurrentProjectConfig(current => ({
    ...current,
    enabledMcpjsonServers: [],
    disabledMcpjsonServers: [],
    enableAllProjectMcpServers: false,
  }))
  cliOk(
    'All project-scoped (.mcp.json) server approvals and rejections have been reset.\n' +
      'You will be prompted for approval next time you start KnightCode.',
  )
}
