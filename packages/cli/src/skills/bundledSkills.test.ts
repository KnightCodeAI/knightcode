import { beforeEach, describe, expect, test } from 'bun:test'
import { clearBundledSkills, getBundledSkills } from './bundledSkills.js'
import { initBundledSkills } from './bundled/index.js'

describe('bundled skills', () => {
  beforeEach(() => {
    clearBundledSkills()
  })

  test('initBundledSkills registers the core skills as prompt commands', () => {
    initBundledSkills()
    const skills = getBundledSkills()
    const names = new Set(skills.map(s => s.name))

    // Skills that ship and register in this build.
    expect(names.has('simplify')).toBe(true)
    expect(names.has('update-config')).toBe(true)
    expect(names.has('batch')).toBe(true)

    // Every bundled skill is a model-invocable prompt command sourced as bundled.
    for (const s of skills) {
      expect(s.type).toBe('prompt')
      if (s.type === 'prompt') {
        expect(s.source).toBe('bundled')
      }
    }
  })

  test('out-of-scope skills are not registered', () => {
    initBundledSkills()
    const names = new Set(getBundledSkills().map(s => s.name))
    // remote/chrome/docs skills are omitted from this build.
    expect(names.has('scheduleRemoteAgents')).toBe(false)
    expect(names.has('knightcodeInChrome')).toBe(false)
  })
})
