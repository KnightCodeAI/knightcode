import React from 'react'
import { MissingKeyNotice } from './components/MissingKeyNotice.js'
import { render, createRoot } from './tui.js'
import { launchRepl } from './replLauncher.js'
import { hasAnthropicApiKeyAuth } from './utils/auth.js'
import { getDefaultAppState } from './state/AppStateStore.js'
import { getEmptyToolPermissionContext } from './Tool.js'
import { getTools } from './tools.js'
import { getCommands } from './commands.js'
import { initBundledSkills } from './skills/bundled/index.js'

// Thin REPL launcher: the full subcommand surface (doctor/resume/headless
// flags) lands with the command-line entrypoint later. For now this boots the
// interactive REPL directly, or prints the missing-key notice and exits.
if (!hasAnthropicApiKeyAuth()) {
  const instance = await render(<MissingKeyNotice />)
  await instance.waitUntilExit()
} else {
  const root = await createRoot()
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
