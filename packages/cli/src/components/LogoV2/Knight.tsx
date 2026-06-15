import * as React from 'react'
import { Box, Text } from '../../tui.js'
import { env } from '../../utils/env.js'

export type KnightPose =
  | 'default'
  | 'arms-up' // ears/mane raised (used during jump)
  | 'look-left' // pupil shifted toward the muzzle
  | 'look-right' // pupil shifted toward the mane

type Props = {
  pose?: KnightPose
}

// A left-facing chess-knight (horse head) on a pedestal, matching the
// KnightCode mark. Three rows, drawn with quadrant block glyphs in the
// knight_body color; the eye is a knight_background gap punched into the head
// so it reads as the mark's glowing eye. Each row is split into segments so a
// pose only varies the eye (look-*) or the ears (arms-up) while the silhouette
// and the bg-filled head band stay stable. All poses are 8 cols wide.
type Segments = {
  /** row 1 left of the head band (ears / mane crest) */
  r1L: string
  /** row 1 head band (bg-filled): forehead with the eye gap */
  r1E: string
  /** row 1 right of the head band (mane) */
  r1R: string
  /** row 2 left (muzzle wedge, pointing left) */
  r2L: string
  /** row 2 right (jaw + neck) */
  r2R: string
}

// The eye gap glyph within the bg-filled forehead band. Shifting which quadrant
// is "lit" moves the pupil. ▛ = forward/down, ▙ = toward muzzle (left),
// ▟ = toward mane (right).
const POSES: Record<KnightPose, Segments> = {
  default: { r1L: ' ▗▟', r1E: '█▛█', r1R: '▙▖', r2L: '▟█', r2R: '██▌' },
  'look-left': { r1L: ' ▗▟', r1E: '█▙█', r1R: '▙▖', r2L: '▟█', r2R: '██▌' },
  'look-right': { r1L: ' ▗▟', r1E: '█▟█', r1R: '▙▖', r2L: '▟█', r2R: '██▌' },
  'arms-up': { r1L: '▗▟▛', r1E: '█▛█', r1R: '▜▖', r2L: '▟█', r2R: '██▌' },
}

// Apple Terminal renders vertical gaps between glyphs but not between
// background fills, so the body is drawn as a bg block and only the eye varies.
const APPLE_EYES: Record<KnightPose, string> = {
  default: '  ▝▘  ',
  'look-left': '  ▖▘  ',
  'look-right': '  ▝▗  ',
  'arms-up': '  ▝▘  ',
}

export function Knight({ pose = 'default' }: Props = {}): React.ReactNode {
  if (env.terminal === 'Apple_Terminal') {
    return <AppleTerminalKnight pose={pose} />
  }
  const p = POSES[pose]
  return (
    <Box flexDirection="column">
      <Text>
        <Text color="knight_body">{p.r1L}</Text>
        <Text color="knight_body" backgroundColor="knight_background">
          {p.r1E}
        </Text>
        <Text color="knight_body">{p.r1R}</Text>
      </Text>
      <Text>
        <Text color="knight_body">{p.r2L}</Text>
        <Text color="knight_body" backgroundColor="knight_background">
          ███
        </Text>
        <Text color="knight_body">{p.r2R}</Text>
      </Text>
      <Text color="knight_body">
        {' '}▝▀▀▀▀▘{' '}
      </Text>
    </Box>
  )
}

function AppleTerminalKnight({ pose }: { pose: KnightPose }): React.ReactNode {
  // Apple's Terminal renders vertical space between chars by default but not
  // between background colors, so we draw the head with a background fill.
  return (
    <Box flexDirection="column" alignItems="center">
      <Text>
        <Text color="knight_body">▗</Text>
        <Text color="knight_background" backgroundColor="knight_body">
          {APPLE_EYES[pose]}
        </Text>
        <Text color="knight_body">▖</Text>
      </Text>
      <Text backgroundColor="knight_body">{' '.repeat(8)}</Text>
      <Text color="knight_body">▝▀▀▀▀▘</Text>
    </Box>
  )
}
