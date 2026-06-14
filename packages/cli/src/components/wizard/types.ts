// Minimal shapes: upstream source not recoverable from the sourcemap.
// Reconstructed from the consuming call sites (WizardProvider's contextValue and
// props, useWizard, WizardDialogLayout, CreateAgentWizard's step list).
import type { ReactNode } from 'react'

export type WizardStepComponent<_T = unknown> = () => ReactNode

export interface WizardContextValue<
  T extends Record<string, unknown> = Record<string, unknown>,
> {
  currentStepIndex: number
  totalSteps: number
  wizardData: T
  setWizardData: React.Dispatch<React.SetStateAction<T>>
  updateWizardData: (updates: Partial<T>) => void
  goNext: () => void
  goBack: () => void
  goToStep: (index: number) => void
  cancel: () => void
  title?: string
  showStepCounter?: boolean
}

export interface WizardProviderProps<
  T extends Record<string, unknown> = Record<string, unknown>,
> {
  steps: WizardStepComponent[]
  initialData?: T
  onComplete: (data: T) => void | Promise<void>
  onCancel?: () => void
  children?: ReactNode
  title?: string
  showStepCounter?: boolean
}
