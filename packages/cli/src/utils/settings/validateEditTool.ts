// TODO: settings-file edit validation (rejecting edits that would corrupt a
// settings JSON file) lands with the settings phase. Until the schema-aware
// validator exists, edits to settings files are not specially validated.

import type { ValidationResult } from '../../Tool.js'

export function validateInputForSettingsFileEdit(
  _filePath: string,
  _originalContent: string,
  _getUpdatedContent: () => string,
): Extract<ValidationResult, { result: false }> | null {
  return null
}
