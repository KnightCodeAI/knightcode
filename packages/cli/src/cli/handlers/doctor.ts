/**
 * `knightcode doctor` — a non-interactive BYOK health check.
 *
 * Upstream's `doctor` reports native auto-updater / install health (npm/GCS
 * dist-tags, install paths, update channels, version locks), which is inert
 * under BYOK — there is no self-updater. This reports the diagnostics that
 * actually matter for an OpenRouter BYOK build: version + runtime, API-key
 * presence, the config dir, settings-file load errors, and configured MCP
 * servers.
 */

import { existsSync } from 'fs'
import { getAllMcpConfigs } from '../../services/mcp/config.js'
import { getKnightcodeApiKeyWithSource } from '../../utils/auth.js'
import { getKnightcodeConfigHomeDir } from '../../utils/envUtils.js'
import { gracefulShutdown } from '../../utils/gracefulShutdown.js'
import { getSettingsWithErrors } from '../../utils/settings/settings.js'

function section(title: string): void {
  process.stdout.write(`\n${title}\n`)
}
function line(label: string, value: string): void {
  process.stdout.write(`  └ ${label}: ${value}\n`)
}

export async function doctorHandler(version: string): Promise<void> {
  process.stdout.write('KnightCode doctor\n')

  // Version + runtime
  section('Version')
  line('KnightCode', version)
  const bunVersion = (globalThis as { Bun?: { version: string } }).Bun?.version
  line('Runtime', bunVersion ? `Bun ${bunVersion}` : `Node ${process.version}`)
  line('Platform', `${process.platform} (${process.arch})`)

  // API key
  section('API key')
  const { key, source } = getKnightcodeApiKeyWithSource({
    skipRetrievingKeyFromApiKeyHelper: true,
  })
  if (key) {
    line('Configured', `yes (source: ${source})`)
  } else {
    line('Configured', 'no — set OPENROUTER_API_KEY or run /login')
  }

  // Config + settings
  section('Config')
  const configDir = getKnightcodeConfigHomeDir()
  line('Config dir', `${configDir}${existsSync(configDir) ? '' : ' (missing)'}`)
  const { errors } = getSettingsWithErrors()
  if (errors.length === 0) {
    line('Settings', 'OK')
  } else {
    line('Settings', `${errors.length} error(s)`)
    for (const e of errors) {
      const loc = e.file ? `${e.file}: ` : ''
      process.stdout.write(`     • ${loc}${e.path}: ${e.message}\n`)
    }
  }

  // MCP servers
  section('MCP servers')
  try {
    const { servers } = await getAllMcpConfigs()
    const names = Object.keys(servers)
    if (names.length === 0) {
      line('Configured', 'none')
    } else {
      line('Configured', String(names.length))
      for (const name of names) {
        const server = servers[name]!
        process.stdout.write(`     • ${name} (${server.type ?? 'stdio'})\n`)
      }
    }
  } catch (err) {
    line('Configured', `error reading config: ${(err as Error).message}`)
  }

  process.stdout.write('\n')
  // getAllMcpConfigs may have started background work (plugin/config loads);
  // shut down cleanly rather than process.exit so handlers can flush.
  await gracefulShutdown(0)
}
