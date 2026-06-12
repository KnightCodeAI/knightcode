import React from 'react'
import { Ansi } from '../Ansi.js'
import Box from './Box.js'

type Props = {
  /**
   * Pre-rendered ANSI lines. Each element must be exactly one terminal row
   * (already wrapped to `width` by the producer) with ANSI escape codes inline.
   */
  lines: string[]
  /** Column width the producer wrapped to. Fixed leaf width for layout. */
  width: number
}

/**
 * Render content that arrives as pre-wrapped ANSI-escaped lines.
 *
 * Upstream this bypassed the parse → layout → re-serialize roundtrip with a
 * raw screen-buffer write. OpenTUI owns the buffer here, so the lines go
 * through the same ANSI parser <Ansi> uses, pinned to the producer's width
 * so layout can't re-wrap them.
 * TODO: feed OpenTUI's text buffer directly once a raw-write API exists.
 */
export function RawAnsi({ lines, width }: Props): React.ReactNode {
  if (lines.length === 0) {
    return null
  }
  return (
    <Box width={width} height={lines.length} flexShrink={0}>
      <Ansi>{lines.join('\n')}</Ansi>
    </Box>
  )
}
