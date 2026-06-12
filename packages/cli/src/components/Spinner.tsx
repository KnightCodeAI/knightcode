import * as React from 'react'
import { Box, Text } from '../tui.js'
import { useAnimationTimer } from '../tui/hooks/use-interval.js'

const FRAMES = ['·', '✢', '✳', '∗', '✻', '✽'] as const
const FRAME_MS = 120

/**
 * The minimal animated activity glyph.
 * TODO: port the full spinner suite (verb lines, shimmer, stall states)
 * with the REPL screens.
 */
export function Spinner(): React.ReactNode {
  const time = useAnimationTimer(FRAME_MS)
  const frame = Math.floor(time / FRAME_MS) % FRAMES.length
  return (
    <Box>
      <Text color="claude">{FRAMES[frame]}</Text>
    </Box>
  )
}
