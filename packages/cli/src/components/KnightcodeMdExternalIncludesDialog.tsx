import React, { useCallback } from 'react'
import { logEvent } from 'src/services/analytics/index.js'
import { Box, Link, Text } from '../tui.js'
import type { ExternalKnightcodeMdInclude } from '../utils/knightcodemd.js'
import { saveCurrentProjectConfig } from '../utils/config.js'
import { Select } from './CustomSelect/index.js'
import { Dialog } from './design-system/Dialog.js'

type Props = {
  onDone(): void
  isStandaloneDialog?: boolean
  externalIncludes?: ExternalKnightcodeMdInclude[]
}

export function KnightcodeMdExternalIncludesDialog({
  onDone,
  isStandaloneDialog,
  externalIncludes,
}: Props): React.ReactNode {
  React.useEffect(() => {
    // Log when dialog is shown
    logEvent('knightcode_knightcode_md_includes_dialog_shown', {})
  }, [])

  const handleSelection = useCallback(
    (value: 'yes' | 'no') => {
      if (value === 'no') {
        logEvent('knightcode_knightcode_md_external_includes_dialog_declined', {})
        // Mark that we've shown the dialog but it was declined
        saveCurrentProjectConfig(current => ({
          ...current,
          hasKnightcodeMdExternalIncludesApproved: false,
          hasKnightcodeMdExternalIncludesWarningShown: true,
        }))
      } else {
        logEvent('knightcode_knightcode_md_external_includes_dialog_accepted', {})
        saveCurrentProjectConfig(current => ({
          ...current,
          hasKnightcodeMdExternalIncludesApproved: true,
          hasKnightcodeMdExternalIncludesWarningShown: true,
        }))
      }

      onDone()
    },
    [onDone],
  )

  const handleEscape = useCallback(() => {
    handleSelection('no')
  }, [handleSelection])

  return (
    <Dialog
      title="Allow external KNIGHTCODE.md file imports?"
      color="warning"
      onCancel={handleEscape}
      hideBorder={!isStandaloneDialog}
      hideInputGuide={!isStandaloneDialog}
    >
      <Text>
        This project&apos;s KNIGHTCODE.md imports files outside the current working
        directory. Never allow this for third-party repositories.
      </Text>

      {externalIncludes && externalIncludes.length > 0 && (
        <Box flexDirection="column">
          <Text dimColor>External imports:</Text>
          {externalIncludes.map((include, i) => (
            <Text key={i} dimColor>
              {'  '}
              {include.path}
            </Text>
          ))}
        </Box>
      )}

      <Text dimColor>
        Important: Only use KnightCode with files you trust. Accessing
        untrusted files may pose security risks{' '}
        <Link url="https://knightcode.raghavseth.in/docs/en/security" />{' '}
      </Text>

      <Select
        options={[
          { label: 'Yes, allow external imports', value: 'yes' },
          { label: 'No, disable external imports', value: 'no' },
        ]}
        onChange={value => handleSelection(value as 'yes' | 'no')}
      />
    </Dialog>
  )
}
