import * as React from 'react'
import { Text } from '../tui.js'

export function PressEnterToContinue(): React.ReactNode {
  return (
    <Text color="permission">
      Press <Text bold>Enter</Text> to continue…
    </Text>
  )
}
