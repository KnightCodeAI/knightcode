import React from 'react'
import { resolve } from 'path'
import { MissingKeyNotice } from './components/MissingKeyNotice.js'
import { render, createRoot, type Root } from './tui.js'
import { launchRepl } from './replLauncher.js'
import { hasKnightcodeApiKeyAuth } from './utils/auth.js'
import { getDefaultAppState } from './state/AppStateStore.js'
import {
  getOriginalCwd,
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
import {
  getActiveAgentsFromList,
  getAgentDefinitionsWithOverrides,
} from './tools/AgentTool/loadAgentsDir.js'
import { loadConversationForResume } from './utils/conversationRecovery.js'
import {
  processResumedConversation,
  type ProcessedResume,
} from './utils/sessionRestore.js'
import { clearSessionCaches } from './commands/clear/caches.js'
import { validateUuid } from './utils/uuid.js'
import {
  getSessionIdFromLog,
  searchSessionsByCustomTitle,
} from './utils/sessionStorage.js'
import { getWorktreePaths } from './utils/getWorktreePaths.js'
import type { LogOption } from './types/logs.js'
import { isMcpSubcommand, runMcpCommand } from './cli/mcpCommand.js'
import { isDoctorSubcommand, runDoctorCommand } from './cli/doctorCommand.js'
import { isAgentsSubcommand, runAgentsCommand } from './cli/agentsCommand.js'
import { CommanderError } from 'commander'

// Read the version from the package manifest for --version output.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const VERSION: string =
  (require('../package.json') as { version?: string }).version ?? '0.0.0'

// `knightcode mcp ...` is a non-interactive CLI surface (configure MCP servers,
// print, exit). It needs no API key and must run before the interactive flag
// parser would otherwise swallow `mcp` as a positional prompt, so route it here
// first.
if (isMcpSubcommand(process.argv)) {
  await runMcpCommand(process.argv)
  // The subcommand handlers print + exit themselves; reaching here means a bare
  // `knightcode mcp` printed help.
  process.exit(0)
}

// `knightcode doctor` is likewise a non-interactive health check that needs no
// API key — route it before the auth check and flag parser too.
if (isDoctorSubcommand(process.argv)) {
  await runDoctorCommand(VERSION)
  process.exit(0)
}

// `knightcode agents` lists configured agents and exits — non-interactive and
// API-key-free, so route it before the auth check and flag parser too.
if (isAgentsSubcommand(process.argv)) {
  await runAgentsCommand(process.argv)
  process.exit(0)
}

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

  // Discover agent definitions once at boot and fold in the active set. The
  // Agent tool, the resume context, and the interactive resume picker all read
  // these from app state — the REPL never loads them itself — so seed them here
  // (mirrors upstream main.tsx).
  const currentCwd = process.cwd()
  const agentDefsResult = await getAgentDefinitionsWithOverrides(currentCwd)
  const agentDefinitions = {
    ...agentDefsResult,
    activeAgents: getActiveAgentsFromList(agentDefsResult.allAgents),
  }

  // Apply CLI overrides onto the default app state (its fields are readonly, so
  // build a new object rather than mutating).
  const base = getDefaultAppState()
  // --dangerously-skip-permissions wins over --permission-mode.
  const mode = cli.dangerouslySkipPermissions
    ? 'bypassPermissions'
    : cli.permissionMode
  const initialState = {
    ...base,
    agentDefinitions,
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
  const commands = await getCommands(currentCwd)

  const renderAndRun = async (r: Root, element: React.ReactNode) => {
    r.render(element)
    await r.waitUntilExit()
  }

  // REPL props shared by every launch path below.
  const sessionConfig = {
    commands,
    debug: false,
    initialTools,
    thinkingConfig: { type: 'disabled' } as const,
    systemPrompt: cli.systemPrompt,
    appendSystemPrompt: cli.appendSystemPrompt,
    disableSlashCommands: cli.disableSlashCommands,
    strictMcpConfig: cli.strictMcpConfig,
  }

  // Context the resume helpers need to restore agent + initial app state.
  // Coordinator mode is out of scope for BYOK, so modeApi stays null; there is
  // no --agent flag in this build, so the main-thread agent / cliAgents are
  // empty.
  const resumeContext = {
    modeApi: null,
    mainThreadAgentDefinition: undefined,
    agentDefinitions,
    currentCwd,
    cliAgents: [],
    initialState,
  }

  if (cli.continueSession) {
    // -c / --continue : reopen the most recent conversation in this directory.
    clearSessionCaches()
    const result = await loadConversationForResume(undefined, undefined)
    if (!result) {
      process.stderr.write('No conversation found to continue.\n')
      process.exit(1)
    }
    const loaded = await processResumedConversation(
      result,
      {
        forkSession: cli.forkSession,
        includeAttribution: true,
        transcriptPath: result.fullPath,
      },
      resumeContext,
    )
    await launchRepl(
      root,
      { getFpsMetrics: () => undefined, initialState: loaded.initialState },
      {
        ...sessionConfig,
        mainThreadAgentDefinition: loaded.restoredAgentDef,
        initialMessages: loaded.messages,
        initialFileHistorySnapshots: loaded.fileHistorySnapshots,
        initialContentReplacements: loaded.contentReplacements,
        initialAgentName: loaded.agentName,
        initialAgentColor: loaded.agentColor,
      },
      renderAndRun,
    )
  } else if (cli.resume !== undefined) {
    // -r / --resume : by UUID, by exact custom title, else interactive picker.
    clearSessionCaches()
    let maybeSessionId =
      typeof cli.resume === 'string' ? validateUuid(cli.resume) : null
    let matchedLog: LogOption | null = null
    let searchTerm: string | undefined

    // A non-UUID value is first tried as an exact custom-title match; a unique
    // hit resumes it directly, otherwise it seeds the picker's search box.
    if (typeof cli.resume === 'string' && !maybeSessionId) {
      const trimmed = cli.resume.trim()
      if (trimmed) {
        const matches = await searchSessionsByCustomTitle(trimmed, {
          exact: true,
        })
        if (matches.length === 1) {
          matchedLog = matches[0] ?? null
          maybeSessionId = matchedLog
            ? getSessionIdFromLog(matchedLog) ?? null
            : null
        } else {
          searchTerm = trimmed
        }
      }
    }

    let processedResume: ProcessedResume | undefined
    if (maybeSessionId) {
      const result = await loadConversationForResume(
        matchedLog ?? maybeSessionId,
        undefined,
      )
      if (!result) {
        process.stderr.write(
          `No conversation found with session ID: ${maybeSessionId}\n`,
        )
        process.exit(1)
      }
      processedResume = await processResumedConversation(
        result,
        {
          forkSession: cli.forkSession,
          sessionIdOverride: maybeSessionId,
          transcriptPath: matchedLog?.fullPath ?? result.fullPath,
        },
        resumeContext,
      )
    }

    if (processedResume) {
      await launchRepl(
        root,
        {
          getFpsMetrics: () => undefined,
          initialState: processedResume.initialState,
        },
        {
          ...sessionConfig,
          mainThreadAgentDefinition: processedResume.restoredAgentDef,
          initialMessages: processedResume.messages,
          initialFileHistorySnapshots: processedResume.fileHistorySnapshots,
          initialContentReplacements: processedResume.contentReplacements,
          initialAgentName: processedResume.agentName,
          initialAgentColor: processedResume.agentColor,
        },
        renderAndRun,
      )
    } else {
      // No direct match → interactive picker (same-repo + worktree sessions).
      const { App } = await import('./components/App.js')
      const { ResumeConversation } = await import(
        './screens/ResumeConversation.js'
      )
      const worktreePaths = await getWorktreePaths(getOriginalCwd())
      await renderAndRun(
        root,
        <App getFpsMetrics={() => undefined} initialState={initialState}>
          <ResumeConversation
            commands={commands}
            worktreePaths={worktreePaths}
            initialTools={initialTools}
            debug={false}
            strictMcpConfig={cli.strictMcpConfig}
            systemPrompt={cli.systemPrompt}
            appendSystemPrompt={cli.appendSystemPrompt}
            initialSearchQuery={searchTerm}
            disableSlashCommands={cli.disableSlashCommands}
            forkSession={cli.forkSession}
            thinkingConfig={{ type: 'disabled' }}
          />
        </App>,
      )
    }
  } else {
    // Normal interactive launch.
    await launchRepl(
      root,
      { getFpsMetrics: () => undefined, initialState },
      { ...sessionConfig },
      renderAndRun,
    )
  }
}
