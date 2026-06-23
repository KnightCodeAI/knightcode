import React from 'react'
import { logEvent } from '../services/analytics/index.js'
import { Box, Text } from '../tui.js'
import { updateSettingsForSource } from '../utils/settings/settings.js'
import { Select } from './CustomSelect/index.js'
import { Dialog } from './design-system/Dialog.js'

// Shown as the warning system message when auto mode engages (REPL) and inside
// the opt-in dialog below. Kept non-empty so the warning is never blank.
export const AUTO_MODE_DESCRIPTION =
  "Auto mode lets Knightcode handle permission prompts automatically — Knightcode checks each tool call for risky actions and prompt injection before executing. Actions Knightcode identifies as safe are executed, while actions Knightcode identifies as risky are blocked and Knightcode may try a different approach. Ideal for long-running tasks. Sessions are slightly more expensive. Knightcode can make mistakes that allow harmful commands to run, it's recommended to only use in isolated environments. Shift+Tab to change mode."

type Props = {
  onAccept(): void
  onDecline(): void
  // Startup gate: decline exits the process, so relabel accordingly.
  declineExits?: boolean
}

export function AutoModeOptInDialog({
  onAccept,
  onDecline,
  declineExits,
}: Props): React.ReactNode {
  React.useEffect(() => {
    logEvent('knightcode_auto_mode_opt_in_dialog_shown', {})
  }, [])

  function onChange(value: 'accept' | 'accept-default' | 'decline') {
    switch (value) {
      case 'accept': {
        logEvent('knightcode_auto_mode_opt_in_dialog_accept', {})
        updateSettingsForSource('userSettings', {
          skipAutoPermissionPrompt: true,
        })
        onAccept()
        break
      }
      case 'accept-default': {
        logEvent('knightcode_auto_mode_opt_in_dialog_accept_default', {})
        updateSettingsForSource('userSettings', {
          skipAutoPermissionPrompt: true,
          permissions: { defaultMode: 'auto' },
        })
        onAccept()
        break
      }
      case 'decline': {
        logEvent('knightcode_auto_mode_opt_in_dialog_decline', {})
        onDecline()
        break
      }
    }
  }

  return (
    <Dialog title="Enable auto mode?" color="warning" onCancel={onDecline}>
      <Box flexDirection="column" gap={1}>
        <Text>{AUTO_MODE_DESCRIPTION}</Text>
      </Box>

      <Select
        options={[
          ...(process.env.USER_TYPE !== 'ant'
            ? [
                {
                  label: 'Yes, and make it my default mode',
                  value: 'accept-default' as const,
                },
              ]
            : []),
          { label: 'Yes, enable auto mode', value: 'accept' as const },
          {
            label: declineExits ? 'No, exit' : 'No, go back',
            value: 'decline' as const,
          },
        ]}
        onChange={value =>
          onChange(value as 'accept' | 'accept-default' | 'decline')
        }
        onCancel={onDecline}
      />
    </Dialog>
  )
}
