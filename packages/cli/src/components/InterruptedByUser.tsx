import * as React from 'react'
import { Text } from '../tui.js'

export function InterruptedByUser(): React.ReactNode {
  return (
    <>
      <Text dimColor>Interrupted </Text>
      <Text dimColor>· What should the model do instead?</Text>
    </>
  )
}
