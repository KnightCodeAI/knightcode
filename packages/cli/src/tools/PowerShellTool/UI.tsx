import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import * as React from 'react'
import { KeyboardShortcutHint } from '../../components/design-system/KeyboardShortcutHint.js'
import { FallbackToolUseErrorMessage } from '../../components/FallbackToolUseErrorMessage.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { Box, Text } from '../../tui.js'
import type { Tool } from '../../Tool.js'
import type { ProgressMessage } from '../../types/message.js'
import type { PowerShellProgress } from '../../types/tools.js'
import type { ThemeName } from '../../utils/theme.js'
import type { Out, PowerShellToolInput } from './PowerShellTool.js'

// The rich OutputLine component lands with the shell UI; render output
// lines plainly until then (error output dimmed in red).
function OutputLine({
  content,
  isError,
}: {
  content: string
  verbose: boolean
  isError?: boolean
}): React.ReactNode {
  return isError ? (
    <Text color="error">{content.trimEnd()}</Text>
  ) : (
    <Text>{content.trimEnd()}</Text>
  )
}

// Constants for command display
const MAX_COMMAND_DISPLAY_LINES = 2
const MAX_COMMAND_DISPLAY_CHARS = 160

export function renderToolUseMessage(
  input: Partial<PowerShellToolInput>,
  { verbose, theme: _theme }: { verbose: boolean; theme: ThemeName },
): React.ReactNode {
  const { command } = input
  if (!command) {
    return null
  }

  const displayCommand = command

  if (!verbose) {
    const lines = displayCommand.split('\n')
    const needsLineTruncation = lines.length > MAX_COMMAND_DISPLAY_LINES
    const needsCharTruncation =
      displayCommand.length > MAX_COMMAND_DISPLAY_CHARS

    if (needsLineTruncation || needsCharTruncation) {
      let truncated = displayCommand

      if (needsLineTruncation) {
        truncated = lines.slice(0, MAX_COMMAND_DISPLAY_LINES).join('\n')
      }

      if (truncated.length > MAX_COMMAND_DISPLAY_CHARS) {
        truncated = truncated.slice(0, MAX_COMMAND_DISPLAY_CHARS)
      }

      return <Text>{truncated.trim()}…</Text>
    }
  }

  return displayCommand
}

export function renderToolUseProgressMessage(
  progressMessagesForMessage: ProgressMessage<PowerShellProgress>[],
  {
    verbose: _verbose,
    tools: _tools,
    terminalSize: _terminalSize,
    inProgressToolCallCount: _inProgressToolCallCount,
  }: {
    tools: Tool[]
    verbose: boolean
    terminalSize?: { columns: number; rows: number }
    inProgressToolCallCount?: number
  },
): React.ReactNode {
  const lastProgress = progressMessagesForMessage.at(-1)

  if (!lastProgress || !lastProgress.data) {
    return (
      <MessageResponse height={1}>
        <Text dimColor>Running…</Text>
      </MessageResponse>
    )
  }

  // The rich ShellProgressMessage component lands with the shell UI; show the
  // tail of the output and elapsed time inline until then.
  const data = lastProgress.data
  const output = String(data.output ?? '')
  const elapsed = Number(data.elapsedTimeSeconds ?? 0)
  return (
    <MessageResponse height={1}>
      <Text dimColor>
        {output ? output.split('\n').at(-1) : 'Running'}… ({elapsed}s)
      </Text>
    </MessageResponse>
  )
}

export function renderToolUseQueuedMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Text dimColor>Waiting…</Text>
    </MessageResponse>
  )
}

export function renderToolResultMessage(
  content: Out,
  progressMessagesForMessage: ProgressMessage<PowerShellProgress>[],
  {
    verbose,
    theme: _theme,
    tools: _tools,
    style: _style,
  }: {
    verbose: boolean
    theme: ThemeName
    tools: Tool[]
    style?: 'condensed'
  },
): React.ReactNode {
  const lastProgress = progressMessagesForMessage.at(-1)
  const timeoutMs = lastProgress?.data?.timeoutMs as number | undefined
  const {
    stdout,
    stderr,
    interrupted,
    returnCodeInterpretation,
    isImage,
    backgroundTaskId,
  } = content

  if (isImage) {
    return (
      <MessageResponse height={1}>
        <Text dimColor>[Image data detected and sent to Claude]</Text>
      </MessageResponse>
    )
  }

  return (
    <Box flexDirection="column">
      {stdout !== '' ? <OutputLine content={stdout} verbose={verbose} /> : null}
      {stderr.trim() !== '' ? (
        <OutputLine content={stderr} verbose={verbose} isError />
      ) : null}
      {stdout === '' && stderr.trim() === '' ? (
        <MessageResponse height={1}>
          <Text dimColor>
            {backgroundTaskId ? (
              <>
                Running in the background{' '}
                <KeyboardShortcutHint shortcut="↓" action="manage" parens />
              </>
            ) : interrupted ? (
              'Interrupted'
            ) : (
              returnCodeInterpretation || '(No output)'
            )}
          </Text>
        </MessageResponse>
      ) : null}
      {timeoutMs ? (
        <MessageResponse>
          <Text dimColor>timeout: {Math.round(timeoutMs / 1000)}s</Text>
        </MessageResponse>
      ) : null}
    </Box>
  )
}

export function renderToolUseErrorMessage(
  result: ToolResultBlockParam['content'],
  {
    verbose,
    progressMessagesForMessage: _progressMessagesForMessage,
    tools: _tools,
  }: {
    verbose: boolean
    progressMessagesForMessage: ProgressMessage<PowerShellProgress>[]
    tools: Tool[]
  },
): React.ReactNode {
  return <FallbackToolUseErrorMessage result={result} verbose={verbose} />
}
