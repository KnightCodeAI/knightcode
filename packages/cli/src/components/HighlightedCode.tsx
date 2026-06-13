// TODO: syntax-highlighted code rendering (theme-aware, fullscreen-aware) lands
// with the transcript renderer's diff/code views. This minimal version prints
// the code plainly so the file tools' result UI is functional; highlighting is
// a later polish pass.

import * as React from 'react'
import { Text } from '../tui.js'

export const HighlightedCode = function HighlightedCode(props: {
  code: string
  [key: string]: unknown
}): React.ReactNode {
  return <Text>{props.code}</Text>
}
