import { describe, expect, test } from 'bun:test'
import insights, {
  buildExportData,
  deduplicateSessionBranches,
  detectMultiClauding,
  generateUsageReport,
} from './insights.js'

// The /insights command is wired through a lazy shim (commands.ts → usageReport)
// that imports this module's default export and calls getPromptForCommand. These
// tests lock that contract so the shim never loads a broken module.
describe('/insights module contract', () => {
  test('default export is the insights prompt command', () => {
    expect(insights.type).toBe('prompt')
    expect(insights.name).toBe('insights')
    if (insights.type !== 'prompt') throw new Error('unreachable')
    expect(typeof insights.getPromptForCommand).toBe('function')
  })

  test('description is rebranded (no brand leak)', () => {
    expect(insights.description).toContain('KnightCode')
  })

  test('analysis helpers the shim/report rely on are exported', () => {
    expect(typeof deduplicateSessionBranches).toBe('function')
    expect(typeof detectMultiClauding).toBe('function')
    expect(typeof buildExportData).toBe('function')
    expect(typeof generateUsageReport).toBe('function')
  })
})
