import React from 'react'
import { Box, Text, useApp } from '../tui.js'

// Shown when no API key is configured: a one-shot notice that exits the
// renderer immediately so the CLI prints the hint and returns to the shell.
export function MissingKeyNotice(): React.ReactNode {
  const { exit } = useApp()
  setTimeout(exit, 50)
  return (
    <Box borderStyle="round" flexDirection="column" paddingX={1}>
      <Text bold>knightcode</Text>
      <Text>
        No API key found. Set OPENROUTER_API_KEY or add one to
        ~/.knightcode/credentials.json.
      </Text>
    </Box>
  )
}
