/**
 * `knightcode mcp ...` CLI subcommands — configure MCP servers from the shell.
 *
 * These run non-interactively (print + exit) and need no API key, so main.tsx
 * routes here before the auth check and before parsing the interactive-session
 * flags. The BYOK-relevant subset is wired: add, add-json, list, get, remove,
 * reset-project-choices. The cloud/SDK-only `serve`, the desktop-app import, and
 * the XAA enterprise IdP subcommands are omitted.
 */

import { Command } from 'commander'
import { addMcpConfig } from '../services/mcp/config.js'
import {
  readClientSecret,
  saveMcpClientSecret,
} from '../services/mcp/auth.js'
import {
  describeMcpConfigFilePath,
  ensureConfigScope,
  ensureTransport,
  parseHeaders,
} from '../services/mcp/utils.js'
import { parseEnvVars } from '../utils/envUtils.js'
import { jsonStringify } from '../utils/slowOperations.js'
import { cliError, cliOk } from './exit.js'

/** True when the argv invokes `knightcode mcp ...`. */
export function isMcpSubcommand(argv: string[]): boolean {
  return argv[2] === 'mcp'
}

/** Registers the `mcp add` subcommand (ported from upstream, minus XAA). */
function registerAddCommand(mcp: Command): void {
  mcp
    .command('add <name> <commandOrUrl> [args...]')
    .description(
      'Add an MCP server to KnightCode.\n\n' +
        'Examples:\n' +
        '  # Add HTTP server:\n' +
        '  knightcode mcp add --transport http sentry https://mcp.sentry.dev/mcp\n\n' +
        '  # Add HTTP server with headers:\n' +
        '  knightcode mcp add --transport http corridor https://app.corridor.dev/api/mcp --header "Authorization: Bearer ..."\n\n' +
        '  # Add stdio server with environment variables:\n' +
        '  knightcode mcp add -e API_KEY=xxx my-server -- npx my-mcp-server\n\n' +
        '  # Add stdio server with subprocess flags:\n' +
        '  knightcode mcp add my-server -- my-command --some-flag arg1',
    )
    .option(
      '-s, --scope <scope>',
      'Configuration scope (local, user, or project)',
      'local',
    )
    .option(
      '-t, --transport <transport>',
      'Transport type (stdio, sse, http). Defaults to stdio if not specified.',
    )
    .option('-e, --env <env...>', 'Set environment variables (e.g. -e KEY=value)')
    .option(
      '-H, --header <header...>',
      'Set request headers (e.g. -H "X-Api-Key: abc123" -H "X-Custom: value")',
    )
    .option('--client-id <clientId>', 'OAuth client ID for HTTP/SSE servers')
    .option(
      '--client-secret',
      'Prompt for OAuth client secret (or set MCP_CLIENT_SECRET env var)',
    )
    .option(
      '--callback-port <port>',
      'Fixed port for OAuth callback (for servers requiring pre-registered redirect URIs)',
    )
    .helpOption('-h, --help', 'Display help for command')
    .action(
      async (
        name: string,
        commandOrUrl: string,
        args: string[],
        options: {
          scope?: string
          transport?: string
          env?: string[]
          header?: string[]
          clientId?: string
          clientSecret?: true
          callbackPort?: string
        },
      ) => {
        // Commander handles `--` natively: everything after it becomes args.
        const actualCommand = commandOrUrl
        const actualArgs = args

        if (!name) {
          cliError(
            'Error: Server name is required.\n' +
              'Usage: knightcode mcp add <name> <command> [args...]',
          )
        } else if (!actualCommand) {
          cliError(
            'Error: Command is required when server name is provided.\n' +
              'Usage: knightcode mcp add <name> <command> [args...]',
          )
        }

        try {
          const scope = ensureConfigScope(options.scope)
          const transport = ensureTransport(options.transport)

          // Was a transport explicitly provided?
          const transportExplicit = options.transport !== undefined

          // Does the command look like a URL (likely incorrect usage)?
          const looksLikeUrl =
            actualCommand.startsWith('http://') ||
            actualCommand.startsWith('https://') ||
            actualCommand.startsWith('localhost') ||
            actualCommand.endsWith('/sse') ||
            actualCommand.endsWith('/mcp')

          if (transport === 'sse' || transport === 'http') {
            if (!actualCommand) {
              cliError(`Error: URL is required for ${transport.toUpperCase()} transport.`)
            }

            const headers = options.header
              ? parseHeaders(options.header)
              : undefined

            const callbackPort = options.callbackPort
              ? parseInt(options.callbackPort, 10)
              : undefined
            const oauth =
              options.clientId || callbackPort
                ? {
                    ...(options.clientId ? { clientId: options.clientId } : {}),
                    ...(callbackPort ? { callbackPort } : {}),
                  }
                : undefined

            const clientSecret =
              options.clientSecret && options.clientId
                ? await readClientSecret()
                : undefined

            const serverConfig = {
              type: transport,
              url: actualCommand,
              headers,
              oauth,
            } as const
            await addMcpConfig(name, serverConfig, scope)

            if (clientSecret) {
              saveMcpClientSecret(name, serverConfig, clientSecret)
            }

            process.stdout.write(
              `Added ${transport.toUpperCase()} MCP server ${name} with URL: ${actualCommand} to ${scope} config\n`,
            )
            if (headers) {
              process.stdout.write(`Headers: ${jsonStringify(headers, null, 2)}\n`)
            }
          } else {
            if (
              options.clientId ||
              options.clientSecret ||
              options.callbackPort
            ) {
              process.stderr.write(
                'Warning: --client-id, --client-secret, and --callback-port are only supported for HTTP/SSE transports and will be ignored for stdio.\n',
              )
            }

            // Warn if this looks like a URL but no transport was specified.
            if (!transportExplicit && looksLikeUrl) {
              process.stderr.write(
                `\nWarning: The command "${actualCommand}" looks like a URL, but is being interpreted as a stdio server as --transport was not specified.\n`,
              )
              process.stderr.write(
                `If this is an HTTP server, use: knightcode mcp add --transport http ${name} ${actualCommand}\n`,
              )
              process.stderr.write(
                `If this is an SSE server, use: knightcode mcp add --transport sse ${name} ${actualCommand}\n`,
              )
            }

            const env = parseEnvVars(options.env)
            await addMcpConfig(
              name,
              { type: 'stdio', command: actualCommand, args: actualArgs, env },
              scope,
            )

            process.stdout.write(
              `Added stdio MCP server ${name} with command: ${actualCommand} ${actualArgs.join(' ')} to ${scope} config\n`,
            )
          }
          cliOk(`File modified: ${describeMcpConfigFilePath(scope)}`)
        } catch (error) {
          cliError((error as Error).message)
        }
      },
    )
}

/** Build the `mcp` command tree. Exported for testing. */
export function buildMcpProgram(): Command {
  const mcp = new Command('mcp')
    .description('Configure and manage MCP servers')
    .enablePositionalOptions()

  registerAddCommand(mcp)

  mcp
    .command('add-json <name> <json>')
    .description('Add an MCP server (stdio, SSE, or HTTP) with a JSON string')
    .option(
      '-s, --scope <scope>',
      'Configuration scope (local, user, or project)',
      'local',
    )
    .option(
      '--client-secret',
      'Prompt for OAuth client secret (or set MCP_CLIENT_SECRET env var)',
    )
    .action(
      async (
        name: string,
        json: string,
        options: { scope?: string; clientSecret?: true },
      ) => {
        const { mcpAddJsonHandler } = await import('./handlers/mcp.js')
        await mcpAddJsonHandler(name, json, options)
      },
    )

  mcp
    .command('list')
    .description(
      'List configured MCP servers. Note: stdio servers from .mcp.json are ' +
        'spawned for health checks. Only use this command in directories you trust.',
    )
    .action(async () => {
      const { mcpListHandler } = await import('./handlers/mcp.js')
      await mcpListHandler()
    })

  mcp
    .command('get <name>')
    .description(
      'Get details about an MCP server. Note: stdio servers from .mcp.json are ' +
        'spawned for health checks. Only use this command in directories you trust.',
    )
    .action(async (name: string) => {
      const { mcpGetHandler } = await import('./handlers/mcp.js')
      await mcpGetHandler(name)
    })

  mcp
    .command('remove <name>')
    .description('Remove an MCP server')
    .option(
      '-s, --scope <scope>',
      'Configuration scope (local, user, or project) - if not specified, ' +
        'removes from whichever scope it exists in',
    )
    .action(async (name: string, options: { scope?: string }) => {
      const { mcpRemoveHandler } = await import('./handlers/mcp.js')
      await mcpRemoveHandler(name, options)
    })

  mcp
    .command('reset-project-choices')
    .description(
      'Reset all approved and rejected project-scoped (.mcp.json) servers ' +
        'within this project',
    )
    .action(async () => {
      const { mcpResetChoicesHandler } = await import('./handlers/mcp.js')
      await mcpResetChoicesHandler()
    })

  return mcp
}

/**
 * Run the `mcp` subcommand. `argv` is the full process.argv; everything after
 * `mcp` is handed to commander. The handlers print and exit themselves; if
 * commander returns (e.g. bare `knightcode mcp`), the caller exits 0.
 */
export async function runMcpCommand(argv: string[]): Promise<void> {
  const mcp = buildMcpProgram()
  // Bare `knightcode mcp` → show help rather than commander's terse error.
  if (argv.length <= 3) {
    mcp.outputHelp()
    return
  }
  await mcp.parseAsync(argv.slice(3), { from: 'user' })
}
