// Reconstructed from consumer usage (the leaked source was an empty stub): a
// selectable option carrying a string value and a renderable label, optionally
// with a description — assignable to the CustomSelect OptionWithDescription.
import type { ReactNode } from 'react'

export interface Option {
  label: ReactNode
  value: string
  description?: string
  dimDescription?: boolean
  disabled?: boolean
}
