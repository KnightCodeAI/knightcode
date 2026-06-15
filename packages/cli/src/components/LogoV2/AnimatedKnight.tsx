import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { Box } from '../../tui.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import { Knight, type KnightPose } from './Knight.js'

type Frame = { pose: KnightPose; offset: number }

/** Hold a pose for n frames (60ms each). */
function hold(pose: KnightPose, offset: number, frames: number): Frame[] {
  return Array.from({ length: frames }, () => ({ pose, offset }))
}

// Offset semantics: marginTop in a fixed-height-3 container. 0 = normal,
// 1 = crouched. Container height stays 3 so the layout never shifts; during
// a crouch (offset=1) Knight's feet row dips below the container and gets
// clipped — reads as "ducking below the frame" before springing back up.

// Click animation: crouch, then spring up with both arms raised. Twice.
const JUMP_WAVE: readonly Frame[] = [
  ...hold('default', 1, 2), // crouch
  ...hold('arms-up', 0, 3), // spring!
  ...hold('default', 0, 1),
  ...hold('default', 1, 2), // crouch again
  ...hold('arms-up', 0, 3), // spring!
  ...hold('default', 0, 1),
]

// Click animation: glance right, then left, then back.
const LOOK_AROUND: readonly Frame[] = [
  ...hold('look-right', 0, 5),
  ...hold('look-left', 0, 5),
  ...hold('default', 0, 1),
]

const CLICK_ANIMATIONS: readonly (readonly Frame[])[] = [JUMP_WAVE, LOOK_AROUND]

const IDLE: Frame = { pose: 'default', offset: 0 }
const FRAME_MS = 60
const incrementFrame = (i: number) => i + 1
const KNIGHT_HEIGHT = 3

/**
 * Knight with click-triggered animations (crouch-jump with arms up, or
 * look-around). Container height is fixed at KNIGHT_HEIGHT — same footprint
 * as a bare `<Knight />` — so the surrounding layout never shifts. During a
 * crouch only the feet row clips (see comment above). Click only fires when
 * mouse tracking is enabled (i.e. inside `<AlternateScreen>` / fullscreen);
 * elsewhere this renders and behaves identically to plain `<Knight />`.
 */
export function AnimatedKnight(): React.ReactNode {
  const { pose, bounceOffset, onClick } = useKnightAnimation()
  return (
    <Box height={KNIGHT_HEIGHT} flexDirection="column" onClick={onClick}>
      <Box marginTop={bounceOffset} flexShrink={0}>
        <Knight pose={pose} />
      </Box>
    </Box>
  )
}

function useKnightAnimation(): {
  pose: KnightPose
  bounceOffset: number
  onClick: () => void
} {
  // Read once at mount — no useSettings() subscription, since that would
  // re-render on any settings change.
  const [reducedMotion] = useState(
    () => getInitialSettings().prefersReducedMotion ?? false,
  )
  const [frameIndex, setFrameIndex] = useState(-1)
  const sequenceRef = useRef<readonly Frame[]>(JUMP_WAVE)

  const onClick = () => {
    if (reducedMotion || frameIndex !== -1) return
    sequenceRef.current =
      CLICK_ANIMATIONS[Math.floor(Math.random() * CLICK_ANIMATIONS.length)]!
    setFrameIndex(0)
  }

  useEffect(() => {
    if (frameIndex === -1) return
    if (frameIndex >= sequenceRef.current.length) {
      setFrameIndex(-1)
      return
    }
    const timer = setTimeout(setFrameIndex, FRAME_MS, incrementFrame)
    return () => clearTimeout(timer)
  }, [frameIndex])

  const seq = sequenceRef.current
  const current =
    frameIndex >= 0 && frameIndex < seq.length ? seq[frameIndex]! : IDLE
  return { pose: current.pose, bounceOffset: current.offset, onClick }
}
