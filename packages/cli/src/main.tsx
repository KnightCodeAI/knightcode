import React from 'react'
import { MissingKeyNotice } from './components/MissingKeyNotice.js'
import { render, createRoot } from './tui.js'
import { launchRepl } from './replLauncher.js'
import { hasKnightcodeApiKeyAuth } from './utils/auth.js'
import { getDefaultAppState } from './state/AppStateStore.js'
import { setQuestionPreviewFormat } from './bootstrap/state.js'
import { getEmptyToolPermissionContext } from './Tool.js'
import { getTools } from './tools.js'
import { getCommands } from './commands.js'
import { initBundledSkills } from './skills/bundled/index.js'
import { handleMcpjsonServerApprovals } from './services/mcpServerApproval.js'

// Thin REPL launcher: the full subcommand surface (doctor/resume/headless
// flags) lands with the command-line entrypoint later. For now this boots the
// interactive REPL directly, or prints the missing-key notice and exits.
if (!hasKnightcodeApiKeyAuth()) {
  const instance = await render(<MissingKeyNotice />)
  await instance.waitUntilExit()
} else {
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

  const initialState = getDefaultAppState()
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
    },
    async (root, element) => {
      root.render(element)
      await root.waitUntilExit()
    },
  )
}
