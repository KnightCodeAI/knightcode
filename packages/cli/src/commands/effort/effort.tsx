import * as React from 'react'
import {
  Select,
  type OptionWithDescription,
} from '../../components/CustomSelect/select.js'
import { Pane } from '../../components/design-system/Pane.js'
import { effortLevelToSymbol } from '../../components/EffortIndicator.js'
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { useAppState, useSetAppState } from '../../state/AppState.js'
import { Box, Text } from '../../tui.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import {
  type EffortValue,
  getDisplayedEffortLevel,
  getEffortEnvOverride,
  getEffortLevelDescription,
  getEffortValueDescription,
  getSupportedEffortLevels,
  isEffortLevel,
  toPersistableEffort,
} from '../../utils/effort.js'
import { updateSettingsForSource } from '../../utils/settings/settings.js'

const COMMON_HELP_ARGS = ['help', '-h', '--help']

type EffortCommandResult = {
  message: string
  effortUpdate?: { value: EffortValue | undefined }
}

function setEffortValue(effortValue: EffortValue): EffortCommandResult {
  const persistable = toPersistableEffort(effortValue)
  // Apply the in-memory change unconditionally below (matching the model
  // picker). A failed settings write only loses persistence across restarts —
  // it must not silently swallow the effort change for the current session.
  let persistError: string | undefined
  if (persistable !== undefined) {
    const result = updateSettingsForSource('userSettings', {
      effortLevel: persistable,
    })
    if (result.error) {
      persistError = result.error.message
    }
  }
  logEvent('knightcode_effort_command', {
    effort:
      effortValue as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  // Env var wins at resolveAppliedEffort time. Only flag it when it actually
  // conflicts — if env matches what the user just asked for, the outcome is
  // the same, so "Set effort to X" is true and the note is noise.
  const envOverride = getEffortEnvOverride()
  if (envOverride !== undefined && envOverride !== effortValue) {
    const envRaw = process.env.KNIGHTCODE_CODE_EFFORT_LEVEL
    if (persistable === undefined) {
      return {
        message: `Not applied: KNIGHTCODE_CODE_EFFORT_LEVEL=${envRaw} overrides effort this session, and ${effortValue} is session-only (nothing saved)`,
        effortUpdate: { value: effortValue },
      }
    }
    return {
      message: `KNIGHTCODE_CODE_EFFORT_LEVEL=${envRaw} overrides this session — clear it and ${effortValue} takes over`,
      effortUpdate: { value: effortValue },
    }
  }

  const description = getEffortValueDescription(effortValue)
  const suffix = persistable !== undefined ? '' : ' (this session only)'
  const note = persistError
    ? ` (couldn't save to settings: ${persistError})`
    : ''
  return {
    message: `Set effort level to ${effortValue}${suffix}: ${description}${note}`,
    effortUpdate: { value: effortValue },
  }
}

export function showCurrentEffort(
  appStateEffort: EffortValue | undefined,
  model: string,
): EffortCommandResult {
  const envOverride = getEffortEnvOverride()
  const effectiveValue =
    envOverride === null ? undefined : (envOverride ?? appStateEffort)
  if (effectiveValue === undefined) {
    const level = getDisplayedEffortLevel(model, appStateEffort)
    return { message: `Effort level: auto (currently ${level})` }
  }
  const description = getEffortValueDescription(effectiveValue)
  return {
    message: `Current effort level: ${effectiveValue} (${description})`,
  }
}

function unsetEffortLevel(): EffortCommandResult {
  const result = updateSettingsForSource('userSettings', {
    effortLevel: undefined,
  })
  if (result.error) {
    return {
      message: `Failed to set effort level: ${result.error.message}`,
    }
  }
  logEvent('knightcode_effort_command', {
    effort:
      'auto' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  // env=auto/unset (null) matches what /effort auto asks for, so only warn
  // when env is pinning a specific level that will keep overriding.
  const envOverride = getEffortEnvOverride()
  if (envOverride !== undefined && envOverride !== null) {
    const envRaw = process.env.KNIGHTCODE_CODE_EFFORT_LEVEL
    return {
      message: `Cleared effort from settings, but KNIGHTCODE_CODE_EFFORT_LEVEL=${envRaw} still controls this session`,
      effortUpdate: { value: undefined },
    }
  }
  return {
    message: 'Effort level set to auto',
    effortUpdate: { value: undefined },
  }
}

export function executeEffort(args: string): EffortCommandResult {
  const normalized = args.toLowerCase()
  if (normalized === 'auto' || normalized === 'unset') {
    return unsetEffortLevel()
  }

  if (!isEffortLevel(normalized)) {
    return {
      message: `Invalid argument: ${args}. Valid options are: none, minimal, low, medium, high, xhigh, max, auto`,
    }
  }

  return setEffortValue(normalized)
}

function ShowCurrentEffort({
  onDone,
}: {
  onDone: (result: string) => void
}): React.ReactNode {
  const effortValue = useAppState(s => s.effortValue)
  const model = useMainLoopModel()
  const { message } = showCurrentEffort(effortValue, model)
  onDone(message)
  return null
}

// Sentinel option value for "reset to the model's default effort".
const EFFORT_AUTO = 'auto' as const

type EffortOptionValue = EffortValue | typeof EFFORT_AUTO

/**
 * Interactive effort picker shown by bare `/effort` (parity with `/model`).
 * Lists the effort levels the current model actually supports plus an "auto"
 * row, applies the choice to AppState (and persists it), then closes.
 */
function EffortPicker({
  onDone,
}: {
  onDone: (result: string) => void
}): React.ReactNode {
  const model = useMainLoopModel()
  const effortValue = useAppState(s => s.effortValue)
  const setAppState = useSetAppState()

  const supported = React.useMemo(
    () => getSupportedEffortLevels(model),
    [model],
  )
  const currentLevel = getDisplayedEffortLevel(model, effortValue)

  // Models with no effort control: report and close rather than show an empty
  // list. Done in an effect so onDone fires after mount (not during render).
  const notSupported = supported.length === 0
  React.useEffect(() => {
    if (notSupported) {
      onDone(
        `${model} doesn't expose an effort setting — it uses the model default.`,
      )
    }
  }, [notSupported, model, onDone])
  if (notSupported) return null

  const options: OptionWithDescription<EffortOptionValue>[] = [
    ...supported.map(level => ({
      label: `${effortLevelToSymbol(level)} ${level}`,
      value: level as EffortOptionValue,
      description: getEffortLevelDescription(level),
    })),
    {
      label: 'auto',
      value: EFFORT_AUTO,
      description: 'Use the default effort level for your model',
    },
  ]

  function handleChange(value: EffortOptionValue): void {
    const result =
      value === EFFORT_AUTO ? unsetEffortLevel() : setEffortValue(value)
    if (result.effortUpdate) {
      setAppState(prev => ({
        ...prev,
        effortValue: result.effortUpdate!.value,
      }))
    }
    onDone(result.message)
  }

  function handleCancel(): void {
    onDone(`Kept effort at ${currentLevel}`)
  }

  // Highlight the effective current choice: a specific level when one is set,
  // otherwise the "auto" row.
  const focusValue: EffortOptionValue =
    effortValue === undefined ? EFFORT_AUTO : currentLevel

  return (
    <Pane color="permission">
      <Box flexDirection="column" width="100%">
        <Box marginBottom={1} flexDirection="column">
          <Text color="remember" bold>
            Select effort level
          </Text>
          <Text dimColor>
            How long the model thinks before answering. Currently {currentLevel}
            .
          </Text>
        </Box>
        <Select
          options={options}
          defaultValue={focusValue}
          defaultFocusValue={focusValue}
          onChange={handleChange}
          onCancel={handleCancel}
        />
      </Box>
    </Pane>
  )
}

function ApplyEffortAndClose({
  result,
  onDone,
}: {
  result: EffortCommandResult
  onDone: (result: string) => void
}): React.ReactNode {
  const setAppState = useSetAppState()
  const { effortUpdate, message } = result
  React.useEffect(() => {
    if (effortUpdate) {
      setAppState(prev => ({
        ...prev,
        effortValue: effortUpdate.value,
      }))
    }
    onDone(message)
  }, [setAppState, effortUpdate, message, onDone])
  return null
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: unknown,
  args?: string,
): Promise<React.ReactNode> {
  args = args?.trim() || ''

  if (COMMON_HELP_ARGS.includes(args)) {
    onDone(
      'Usage: /effort [none|minimal|low|medium|high|xhigh|max|auto]\n\nEffort levels:\n- none: No reasoning effort (thinking disabled)\n- minimal: Minimal reasoning effort for quick answers\n- low: Quick, straightforward implementation\n- medium: Balanced approach with standard testing\n- high: Comprehensive implementation with extensive testing\n- xhigh: Extremely high capability with deep thinking\n- max: Maximum capability with deepest reasoning (Opus 4.6 only)\n- auto: Use the default effort level for your model',
    )
    return
  }

  // Bare `/effort` opens the interactive picker (parity with `/model`);
  // `/effort current|status` keeps the read-only status output.
  if (!args) {
    return <EffortPicker onDone={onDone} />
  }

  if (args === 'current' || args === 'status') {
    return <ShowCurrentEffort onDone={onDone} />
  }

  const result = executeEffort(args)
  return <ApplyEffortAndClose result={result} onDone={onDone} />
}
