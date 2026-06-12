import React from 'react'
import { Box, Text, render, useApp, useInput } from './tui.js'

function Smoke() {
  const { exit } = useApp()
  useInput(input => {
    if (input === 'q') exit()
  })
  return (
    <Box borderStyle="round" flexDirection="column" paddingX={1}>
      <Text bold>knightcode</Text>
      <Text dimColor>renderer up — press q to quit</Text>
    </Box>
  )
}

const instance = await render(<Smoke />)
await instance.waitUntilExit()
