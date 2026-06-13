// TODO: the structured-diff edit result view (per-hunk colored diff) lands with
// the transcript renderer's diff views. This minimal version prints the edited
// file path so the Edit tool's result UI is functional.

import * as React from 'react'
import { Text } from '../tui.js'

export function FileEditToolUpdatedMessage(props: {
  filePath: string
  [key: string]: unknown
}): React.ReactNode {
  return <Text>Updated {props.filePath}</Text>
}
