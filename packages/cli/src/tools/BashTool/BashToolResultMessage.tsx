import * as React from 'react'
import { Box, Text } from '../../tui.js'
import { OutputLine } from '../../components/shell/OutputLine.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { ShellTimeDisplay } from '../../components/shell/ShellTimeDisplay.js'

// Renders Bash tool output (stdout/stderr) plus the cwd-reset warning, the
// no-output fallback, and an optional timeout display. Used both by the Bash
// tool result view (BashTool/UI.tsx) and by user-message bash output (the
// `!`-command passthrough via UserBashOutputMessage).
type Props = {
  content: {
    stdout?: string
    stderr?: string
    isImage?: boolean
    returnCodeInterpretation?: string
    noOutputExpected?: boolean
    backgroundTaskId?: string
  }
  verbose?: boolean
  timeoutMs?: number
}

// Matches "Shell cwd was reset to <path>" at start-of-string or after a newline.
const SHELL_CWD_RESET_PATTERN = /(?:^|\n)(Shell cwd was reset to .+)$/

function extractCwdResetWarning(stderr: string): {
  cleanedStderr: string
  cwdResetWarning: string | null
} {
  const match = stderr.match(SHELL_CWD_RESET_PATTERN)
  if (!match) return { cleanedStderr: stderr, cwdResetWarning: null }
  return {
    cleanedStderr: stderr.replace(SHELL_CWD_RESET_PATTERN, '').trim(),
    cwdResetWarning: match[1] ?? null,
  }
}

export function BashToolResultMessage({
  content: {
    stdout = '',
    stderr: rawStderr = '',
    isImage,
    returnCodeInterpretation,
    noOutputExpected,
    backgroundTaskId,
  },
  verbose,
  timeoutMs,
}: Props): React.ReactNode {
  const { cleanedStderr: stderr, cwdResetWarning } =
    extractCwdResetWarning(rawStderr)

  if (isImage) {
    return (
      <MessageResponse height={1}>
        <Text dimColor>[Image data detected and sent to the model]</Text>
      </MessageResponse>
    )
  }

  return (
    <Box flexDirection="column">
      {stdout !== '' ? (
        <OutputLine content={stdout} verbose={!!verbose} />
      ) : null}
      {stderr.trim() !== '' ? (
        <OutputLine content={stderr} verbose={!!verbose} isError />
      ) : null}
      {cwdResetWarning ? (
        <MessageResponse>
          <Text dimColor>{cwdResetWarning}</Text>
        </MessageResponse>
      ) : null}
      {stdout === '' && stderr.trim() === '' && !cwdResetWarning ? (
        <MessageResponse height={1}>
          <Text dimColor>
            {backgroundTaskId
              ? 'Running in the background'
              : returnCodeInterpretation ||
                (noOutputExpected ? 'Done' : '(No output)')}
          </Text>
        </MessageResponse>
      ) : null}
      {timeoutMs ? (
        <MessageResponse>
          <ShellTimeDisplay timeoutMs={timeoutMs} />
        </MessageResponse>
      ) : null}
    </Box>
  )
}

export default BashToolResultMessage
