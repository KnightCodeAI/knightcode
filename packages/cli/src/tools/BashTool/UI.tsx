import * as React from 'react'
import { KeyboardShortcutHint } from '../../components/design-system/KeyboardShortcutHint.js'
import { Box, Text } from '../../tui.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

// Hint shown while a foreground shell command runs, offering to background it.
// The ctrl+b keybinding and backgroundAll() wiring belong to the task framework
// (deferred); until then this renders the hint chrome only.
export function BackgroundHint(
  _props: { onBackground?: () => void } = {},
): React.ReactNode {
  if (isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS)) {
    return null
  }
  return (
    <Box paddingLeft={5}>
      <Text dimColor>
        <KeyboardShortcutHint
          shortcut="ctrl+b"
          action="run in background"
          parens
        />
      </Text>
    </Box>
  )
}
