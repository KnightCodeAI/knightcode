// TODO: the rejected-edit diff view (showing the change the user declined)
// lands with the transcript renderer's diff views. This minimal version prints
// a rejection line so the file tools' rejection UI is functional.

import * as React from 'react'
import { Text } from '../tui.js'

export function FileEditToolUseRejectedMessage(props: {
  file_path: string
  operation: 'write' | 'update'
  [key: string]: unknown
}): React.ReactNode {
  return (
    <Text>
      User rejected {props.operation === 'write' ? 'write to' : 'edit of'}{' '}
      {props.file_path}
    </Text>
  )
}
