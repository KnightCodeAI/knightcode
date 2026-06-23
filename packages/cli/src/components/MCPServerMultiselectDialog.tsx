import partition from 'lodash-es/partition.js'
import React, { useCallback } from 'react'
import { logEvent } from '../services/analytics/index.js'
import { Box, Text } from '../tui.js'
import {
  getSettings_DEPRECATED,
  updateSettingsForSource,
} from '../utils/settings/settings.js'
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js'
import { SelectMulti } from './CustomSelect/SelectMulti.js'
import { Byline } from './design-system/Byline.js'
import { Dialog } from './design-system/Dialog.js'
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js'
import { MCPServerDialogCopy } from './MCPServerDialogCopy.js'

type Props = {
  serverNames: string[]
  onDone(): void
}

export function MCPServerMultiselectDialog({
  serverNames,
  onDone,
}: Props): React.ReactNode {
  function onSubmit(selectedServers: string[]) {
    const currentSettings = getSettings_DEPRECATED() || {}
    const enabledServers = currentSettings.enabledMcpjsonServers || []
    const disabledServers = currentSettings.disabledMcpjsonServers || []

    const [approvedServers, rejectedServers] = partition(serverNames, server =>
      selectedServers.includes(server),
    )

    logEvent('knightcode_mcp_multidialog_choice', {
      approved: approvedServers.length,
      rejected: rejectedServers.length,
    })

    if (approvedServers.length > 0) {
      const newEnabledServers = [
        ...new Set([...enabledServers, ...approvedServers]),
      ]
      updateSettingsForSource('localSettings', {
        enabledMcpjsonServers: newEnabledServers,
      })
    }

    if (rejectedServers.length > 0) {
      const newDisabledServers = [
        ...new Set([...disabledServers, ...rejectedServers]),
      ]
      updateSettingsForSource('localSettings', {
        disabledMcpjsonServers: newDisabledServers,
      })
    }

    onDone()
  }

  // ESC rejects all servers.
  const handleEscRejectAll = useCallback(() => {
    const currentSettings = getSettings_DEPRECATED() || {}
    const disabledServers = currentSettings.disabledMcpjsonServers || []
    const newDisabledServers = [
      ...new Set([...disabledServers, ...serverNames]),
    ]
    updateSettingsForSource('localSettings', {
      disabledMcpjsonServers: newDisabledServers,
    })
    onDone()
  }, [serverNames, onDone])

  return (
    <>
      <Dialog
        title={`${serverNames.length} new MCP servers found in .mcp.json`}
        subtitle="Select any you wish to enable."
        color="warning"
        onCancel={handleEscRejectAll}
        hideInputGuide
      >
        <MCPServerDialogCopy />

        <SelectMulti
          options={serverNames.map(server => ({
            label: server,
            value: server,
          }))}
          defaultValue={serverNames}
          onSubmit={onSubmit}
          onCancel={handleEscRejectAll}
          hideIndexes
        />
      </Dialog>
      <Box paddingX={1}>
        <Text dimColor italic>
          <Byline>
            <KeyboardShortcutHint shortcut="Space" action="select" />
            <KeyboardShortcutHint shortcut="Enter" action="confirm" />
            <ConfigurableShortcutHint
              action="confirm:no"
              context="Confirmation"
              fallback="Esc"
              description="reject all"
            />
          </Byline>
        </Text>
      </Box>
    </>
  )
}
