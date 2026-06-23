import { afterEach, describe, expect, test } from 'bun:test'
import type { FrontmatterData } from '../utils/frontmatterParser.js'
import type { MarkdownFile } from '../utils/markdownConfigLoader.js'
import {
  activateConditionalSkillsForPaths,
  clearDynamicSkills,
  createSkillCommand,
  getConditionalSkillCount,
  getDynamicSkills,
  getSkillsPath,
  parseSkillFrontmatterFields,
  transformSkillFiles,
} from './loadSkillsDir.js'

function mdFile(filePath: string, baseDir: string): MarkdownFile {
  return {
    filePath,
    baseDir,
    frontmatter: {} as FrontmatterData,
    content: '',
    source: 'projectSettings',
  }
}

afterEach(() => {
  clearDynamicSkills()
})

describe('parseSkillFrontmatterFields', () => {
  test('parses a fully-specified skill frontmatter', () => {
    const fm = {
      name: 'My Skill',
      description: 'Does a thing',
      'allowed-tools': 'Read, Grep',
      'argument-hint': '<file>',
      when_to_use: 'when you need a thing',
      version: '1.2.3',
      model: 'opus',
      'user-invocable': 'false',
      context: 'fork',
      agent: 'general-purpose',
    } as FrontmatterData

    const parsed = parseSkillFrontmatterFields(fm, 'body', 'my-skill')
    expect(parsed.displayName).toBe('My Skill')
    expect(parsed.description).toBe('Does a thing')
    expect(parsed.hasUserSpecifiedDescription).toBe(true)
    expect(parsed.allowedTools).toEqual(['Read', 'Grep'])
    expect(parsed.argumentHint).toBe('<file>')
    expect(parsed.whenToUse).toBe('when you need a thing')
    expect(parsed.version).toBe('1.2.3')
    expect(parsed.userInvocable).toBe(false)
    expect(parsed.executionContext).toBe('fork')
    expect(parsed.agent).toBe('general-purpose')
  })

  test('defaults: userInvocable true, no description -> falls back to markdown', () => {
    const parsed = parseSkillFrontmatterFields(
      {} as FrontmatterData,
      '# Heading\n\nbody text',
      'skill-x',
    )
    expect(parsed.userInvocable).toBe(true)
    expect(parsed.hasUserSpecifiedDescription).toBe(false)
    expect(parsed.description).toBe('Heading')
    expect(parsed.executionContext).toBeUndefined()
  })

  test("model: 'inherit' yields undefined model", () => {
    const parsed = parseSkillFrontmatterFields(
      { description: 'd', model: 'inherit' } as FrontmatterData,
      'b',
      'skill-y',
    )
    expect(parsed.model).toBeUndefined()
  })
})

describe('createSkillCommand', () => {
  test('produces a prompt command with expected shape', () => {
    const parsed = parseSkillFrontmatterFields(
      { description: 'desc' } as FrontmatterData,
      'content here',
      'demo',
    )
    const cmd = createSkillCommand({
      ...parsed,
      skillName: 'demo',
      markdownContent: 'content here',
      source: 'projectSettings',
      baseDir: '/proj/.knightcode/skills/demo',
      loadedFrom: 'skills',
      paths: undefined,
    })

    expect(cmd.type).toBe('prompt')
    expect(cmd.name).toBe('demo')
    expect(cmd.description).toBe('desc')
    expect(cmd.loadedFrom).toBe('skills')
    expect(cmd.userInvocable).toBe(true)
    expect(cmd.isHidden).toBe(false)
    if (cmd.type === 'prompt') {
      expect(cmd.skillRoot).toBe('/proj/.knightcode/skills/demo')
      expect(cmd.contentLength).toBe('content here'.length)
    }
  })

  test('user-invocable: false -> isHidden true', () => {
    const parsed = parseSkillFrontmatterFields(
      { description: 'd', 'user-invocable': 'false' } as FrontmatterData,
      'c',
      'hidden',
    )
    const cmd = createSkillCommand({
      ...parsed,
      skillName: 'hidden',
      markdownContent: 'c',
      source: 'userSettings',
      baseDir: undefined,
      loadedFrom: 'skills',
      paths: undefined,
    })
    expect(cmd.userInvocable).toBe(false)
    expect(cmd.isHidden).toBe(true)
  })
})

describe('transformSkillFiles', () => {
  test('collapses a directory with a SKILL.md to only that file', () => {
    const files = [
      mdFile('/x/skills/foo/SKILL.md', '/x/skills'),
      mdFile('/x/skills/foo/other.md', '/x/skills'),
    ]
    const result = transformSkillFiles(files)
    expect(result).toHaveLength(1)
    expect(result[0]!.filePath).toBe('/x/skills/foo/SKILL.md')
  })

  test('keeps regular files in dirs without a SKILL.md', () => {
    const files = [
      mdFile('/x/cmds/a.md', '/x/cmds'),
      mdFile('/x/cmds/b.md', '/x/cmds'),
    ]
    const result = transformSkillFiles(files)
    expect(result.map(f => f.filePath).sort()).toEqual([
      '/x/cmds/a.md',
      '/x/cmds/b.md',
    ])
  })
})

describe('getSkillsPath', () => {
  test('project source uses .knightcode prefix', () => {
    expect(getSkillsPath('projectSettings', 'skills')).toBe(
      '.knightcode/skills',
    )
    expect(getSkillsPath('projectSettings', 'commands')).toBe(
      '.knightcode/commands',
    )
  })
})

describe('activateConditionalSkillsForPaths', () => {
  test('no conditional skills -> returns []', () => {
    expect(activateConditionalSkillsForPaths(['src/a.ts'], '/proj')).toEqual([])
    expect(getConditionalSkillCount()).toBe(0)
    expect(getDynamicSkills()).toEqual([])
  })
})
