// TODO: voice mode — the recording/processing indicator and warm-up hint shown
// in the prompt footer when voice input is active. Voice is not part of this
// build; both render nothing so the footer composes as if voice were disabled.
import type * as React from 'react'

type Props = {
  voiceState: 'idle' | 'recording' | 'processing'
}

export function VoiceIndicator(_props: Props): React.ReactNode {
  return null
}

export function VoiceWarmupHint(): React.ReactNode {
  return null
}
