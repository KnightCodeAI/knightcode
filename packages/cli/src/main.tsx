import React from 'react'
import { resolve } from 'path'
import { MissingKeyNotice } from './components/MissingKeyNotice.js'
import { render, createRoot } from './tui.js'
import { launchRepl } from './replLauncher.js'
import { hasKnightcodeApiKeyAuth } from './utils/auth.js'
import { getDefaultAppState } from './state/AppStateStore.js'
import {
  setAdditionalDirectoriesForKnightcodeMd,
  setAllowedSettingSources,
  setQuestionPreviewFormat,
} from './bootstrap/state.js'
import { getEmptyToolPermissionContext } from './Tool.js'
import { getTools } from './tools.js'
import { getCommands } from './commands.js'
import { initBundledSkills } from './skills/bundled/index.js'
import { handleMcpjsonServerApprovals } from './services/mcpServerApproval.js'
import { parseCliArgs } from './cli/parseArgs.js'
import { parseSettingSourcesFlag } from './utils/settings/constants.js'
import { validateModel } from './utils/model/validateModel.js'
import { createUserMessage } from './utils/messages.js'
import { CommanderError } from 'commander'

// Read the version from the package manifest for --version output.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const VERSION: string =
  (require('../package.json') as { version?: string }).version ?? '0.0.0'

// Parse CLI args. commander (via exitOverride) throws on --help/--version and on
// parse errors; it has already printed the relevant output, so just exit.
let cli
try {
  cli = parseCliArgs(process.argv.slice(2), VERSION)
} catch (err) {
  const code = err instanceof CommanderError ? err.exitCode : 1
  process.exit(code)
}

if (cli.print) {
  process.stderr.write(
    'Headless print mode (-p/--print) is not available in this build. ' +
      'KnightCode runs as an interactive session.\n',
  )
  process.exit(1)
}

if (!hasKnightcodeApiKeyAuth()) {
  const instance = await render(<MissingKeyNotice />)
  await instance.waitUntilExit()
} else {
  // --bare: minimal mode. Set before any subsystem reads it.
  if (cli.bare) {
    process.env.KNIGHTCODE_CODE_SIMPLE = '1'
  }

  // Restrict which settings sources are loaded, if requested.
  if (cli.settingSources) {
    setAllowedSettingSources(parseSettingSourcesFlag(cli.settingSources))
  }

  // Extra directories tool access is allowed in (resolved to absolute).
  if (cli.addDir.length > 0) {
    setAdditionalDirectoriesForKnightcodeMd(cli.addDir.map(d => resolve(d)))
  }

  // Validate --model against the allowlist before launching.
  if (cli.model) {
    const result = await validateModel(cli.model)
    if (!result.valid) {
      process.stderr.write(`${result.error ?? 'Invalid model'}\n`)
      process.exit(1)
    }
  }

  // Seed the AskUserQuestion preview format. The TUI renders option previews,
  // so default the interactive CLI to 'markdown' (upstream does the same for
  // clientType 'cli'); honor an explicit env override when set.
  const previewFormat = process.env.KNIGHTCODE_CODE_QUESTION_PREVIEW_FORMAT
  if (previewFormat === 'markdown' || previewFormat === 'html') {
    setQuestionPreviewFormat(previewFormat)
  } else {
    setQuestionPreviewFormat('markdown')
  }

  const root = await createRoot()

  // Before the REPL mounts, prompt the user to approve/reject any new project
  // (.mcp.json) MCP servers. Resolves immediately when there are none pending.
  await handleMcpjsonServerApprovals(root)

  // Apply CLI overrides onto the default app state (its fields are readonly, so
  // build a new object rather than mutating).
  const base = getDefaultAppState()
  // --dangerously-skip-permissions wins over --permission-mode.
  const mode = cli.dangerouslySkipPermissions
    ? 'bypassPermissions'
    : cli.permissionMode
  const initialState = {
    ...base,
    ...(cli.verbose ? { verbose: true } : {}),
    ...(cli.model ? { mainLoopModel: cli.model } : {}),
    ...(mode
      ? { toolPermissionContext: { ...base.toolPermissionContext, mode } }
      : {}),
    // A positional prompt is pre-submitted on launch.
    ...(cli.prompt
      ? {
          initialMessage: {
            message: createUserMessage({ content: cli.prompt }),
          },
        }
      : {}),
  }

  const initialTools = [...getTools(getEmptyToolPermissionContext())]
  // Register bundled skills before the first getCommands() so they appear in
  // the slash-command list and are model-invocable from the first turn.
  initBundledSkills()
  const commands = await getCommands(process.cwd())
  await launchRepl(
    root,
    {
      getFpsMetrics: () => undefined,
      initialState,
    },
    {
      commands,
      debug: false,
      initialTools,
      thinkingConfig: { type: 'disabled' },
      systemPrompt: cli.systemPrompt,
      appendSystemPrompt: cli.appendSystemPrompt,
      disableSlashCommands: cli.disableSlashCommands,
      strictMcpConfig: cli.strictMcpConfig,
    },
    async (root, element) => {
      root.render(element)
      await root.waitUntilExit()
    },
  )
}
