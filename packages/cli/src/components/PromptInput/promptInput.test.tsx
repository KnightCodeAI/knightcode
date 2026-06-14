import { describe, expect, test } from 'bun:test'
import {
  getModeFromInput,
  getValueFromInput,
  isInputModeCharacter,
  prependModeCharacterToInput,
} from './inputModes.js'

// The full <PromptInput> render test (mount, type characters, press Return,
// assert onSubmit fires with the typed text) is deferred to the Task-14 boot
// gate: PromptInput pulls the REPL, status chrome, and REPL hooks at module
// load, none of which exist until those later tasks land. Here we cover the
// runnable, verbatim submit-path logic the input box composes — how a typed
// buffer is turned into the string that is submitted, and how a stored history
// entry's mode and value are recovered from it.

describe('prependModeCharacterToInput — what gets submitted', () => {
  test('bash mode prefixes the input with !', () => {
    expect(prependModeCharacterToInput('ls -la', 'bash')).toBe('!ls -la')
  })

  test('prompt mode submits the input unchanged', () => {
    expect(prependModeCharacterToInput('hello world', 'prompt')).toBe(
      'hello world',
    )
  })
})

describe('getModeFromInput — recovering the mode from a stored line', () => {
  test('a leading ! is bash mode', () => {
    expect(getModeFromInput('!echo hi')).toBe('bash')
  })

  test('anything else is prompt mode', () => {
    expect(getModeFromInput('echo hi')).toBe('prompt')
  })
})

describe('getValueFromInput — recovering the typed value', () => {
  test('strips the leading mode character for bash', () => {
    expect(getValueFromInput('!ls -la')).toBe('ls -la')
  })

  test('returns prompt input verbatim', () => {
    expect(getValueFromInput('hello world')).toBe('hello world')
  })

  test('round-trips with prependModeCharacterToInput', () => {
    const typed = 'git status'
    const submitted = prependModeCharacterToInput(typed, 'bash')
    expect(getModeFromInput(submitted)).toBe('bash')
    expect(getValueFromInput(submitted)).toBe(typed)
  })
})

describe('isInputModeCharacter', () => {
  test('only ! toggles a mode', () => {
    expect(isInputModeCharacter('!')).toBe(true)
    expect(isInputModeCharacter('a')).toBe(false)
    expect(isInputModeCharacter('!!')).toBe(false)
  })
})
