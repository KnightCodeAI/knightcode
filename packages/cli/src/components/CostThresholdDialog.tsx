import React from 'react'
import { Box, Link, Text } from '../tui.js'
import { Select } from './CustomSelect/index.js'
import { Dialog } from './design-system/Dialog.js'

type Props = {
  onDone: () => void
}

export function CostThresholdDialog({ onDone }: Props): React.ReactNode {
  return (
    <Dialog
      title="You've spent $5 on the KnightCode API this session."
      onCancel={onDone}
    >
      <Box flexDirection="column">
        <Text>Learn more about how to monitor your spending:</Text>
        <Link url="https://knightcode.raghavseth.in/docs/en/costs" />
      </Box>
      <Select
        options={[
          {
            value: 'ok',
            label: 'Got it, thanks!',
          },
        ]}
        onChange={onDone}
      />
    </Dialog>
  )
}
