import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  getQuestionPreviewFormat,
  setQuestionPreviewFormat,
} from '../../bootstrap/state.js'
import { getAllBaseTools } from '../../tools.js'
import { AskUserQuestionTool } from './AskUserQuestionTool.js'
import {
  ASK_USER_QUESTION_TOOL_NAME,
  ASK_USER_QUESTION_TOOL_PROMPT,
  PREVIEW_FEATURE_PROMPT,
} from './prompt.js'

function validQuestionsInput() {
  return {
    questions: [
      {
        question: 'Which database should we use?',
        header: 'Database',
        options: [
          { label: 'Postgres', description: 'Relational' },
          { label: 'SQLite', description: 'Embedded' },
        ],
        multiSelect: false,
      },
    ],
  }
}

describe('AskUserQuestionTool inputSchema', () => {
  test('accepts a well-formed single question', () => {
    const r = AskUserQuestionTool.inputSchema.safeParse(validQuestionsInput())
    expect(r.success).toBe(true)
  })

  test('rejects duplicate question texts', () => {
    const input = {
      questions: [
        {
          question: 'Same?',
          header: 'A',
          options: [
            { label: 'x', description: 'd' },
            { label: 'y', description: 'd' },
          ],
        },
        {
          question: 'Same?',
          header: 'B',
          options: [
            { label: 'p', description: 'd' },
            { label: 'q', description: 'd' },
          ],
        },
      ],
    }
    expect(AskUserQuestionTool.inputSchema.safeParse(input).success).toBe(false)
  })

  test('rejects duplicate option labels within a question', () => {
    const input = {
      questions: [
        {
          question: 'Pick one',
          header: 'Pick',
          options: [
            { label: 'dup', description: 'd' },
            { label: 'dup', description: 'd' },
          ],
        },
      ],
    }
    expect(AskUserQuestionTool.inputSchema.safeParse(input).success).toBe(false)
  })

  test('rejects fewer than 2 options', () => {
    const input = {
      questions: [
        {
          question: 'Pick one',
          header: 'Pick',
          options: [{ label: 'only', description: 'd' }],
        },
      ],
    }
    expect(AskUserQuestionTool.inputSchema.safeParse(input).success).toBe(false)
  })
})

describe('AskUserQuestionTool registration & flags', () => {
  test('is registered in getAllBaseTools', () => {
    expect(
      getAllBaseTools().some(t => t.name === ASK_USER_QUESTION_TOOL_NAME),
    ).toBe(true)
  })

  test('is enabled, read-only, and requires user interaction', () => {
    expect(AskUserQuestionTool.isEnabled()).toBe(true)
    expect(AskUserQuestionTool.isReadOnly()).toBe(true)
    expect(AskUserQuestionTool.requiresUserInteraction?.()).toBe(true)
    expect(AskUserQuestionTool.isConcurrencySafe({} as never)).toBe(true)
  })

  test('checkPermissions asks the user to answer', async () => {
    const input = validQuestionsInput()
    const result = await AskUserQuestionTool.checkPermissions!(
      input as never,
      {} as never,
    )
    expect(result.behavior).toBe('ask')
  })

  test('classifier input joins the question texts', () => {
    expect(
      AskUserQuestionTool.toAutoClassifierInput({
        questions: [
          { question: 'A?', header: 'h', options: [], multiSelect: false },
          { question: 'B?', header: 'h', options: [], multiSelect: false },
        ],
      } as never),
    ).toBe('A? | B?')
  })
})

describe('AskUserQuestionTool prompt()', () => {
  test('always starts with the base tool prompt', async () => {
    expect(await AskUserQuestionTool.prompt({} as never)).toContain(
      ASK_USER_QUESTION_TOOL_PROMPT.trimEnd(),
    )
  })

  test('appends markdown preview guidance when format is markdown', async () => {
    setQuestionPreviewFormat('markdown')
    const prompt = await AskUserQuestionTool.prompt({} as never)
    expect(prompt).toContain(PREVIEW_FEATURE_PROMPT.markdown)
  })

  test('appends html preview guidance when format is html', async () => {
    setQuestionPreviewFormat('html')
    const prompt = await AskUserQuestionTool.prompt({} as never)
    expect(prompt).toContain(PREVIEW_FEATURE_PROMPT.html)
  })
})

describe('AskUserQuestionTool.validateInput (html preview checks)', () => {
  const prev = getQuestionPreviewFormat()
  beforeEach(() => setQuestionPreviewFormat('html'))
  afterEach(() => setQuestionPreviewFormat(prev === 'html' ? 'html' : 'markdown'))

  function inputWithPreview(preview: string) {
    return {
      questions: [
        {
          question: 'Pick a layout',
          header: 'Layout',
          options: [
            { label: 'A', description: 'd', preview },
            { label: 'B', description: 'd' },
          ],
          multiSelect: false,
        },
      ],
    }
  }

  test('accepts a valid HTML fragment', async () => {
    const r = await AskUserQuestionTool.validateInput!(
      inputWithPreview('<div>hi</div>') as never,
      {} as never,
    )
    expect(r.result).toBe(true)
  })

  test('rejects a full HTML document', async () => {
    const r = await AskUserQuestionTool.validateInput!(
      inputWithPreview('<html><body>x</body></html>') as never,
      {} as never,
    )
    expect(r.result).toBe(false)
  })

  test('rejects script/style tags', async () => {
    const r = await AskUserQuestionTool.validateInput!(
      inputWithPreview('<div><script>alert(1)</script></div>') as never,
      {} as never,
    )
    expect(r.result).toBe(false)
  })

  test('rejects non-HTML preview text', async () => {
    const r = await AskUserQuestionTool.validateInput!(
      inputWithPreview('just plain text') as never,
      {} as never,
    )
    expect(r.result).toBe(false)
  })
})

describe('AskUserQuestionTool.call & result mapping', () => {
  test('call returns the submitted questions/answers/annotations', async () => {
    const out = await AskUserQuestionTool.call(
      {
        questions: validQuestionsInput().questions,
        answers: { 'Which database should we use?': 'Postgres' },
        annotations: {
          'Which database should we use?': { notes: 'prefer managed' },
        },
      } as never,
      {} as never,
    )
    expect(out.data.answers['Which database should we use?']).toBe('Postgres')
    expect(out.data.annotations?.['Which database should we use?']?.notes).toBe(
      'prefer managed',
    )
  })

  test('mapToolResultToToolResultBlockParam renders answers and annotations', () => {
    const block = AskUserQuestionTool.mapToolResultToToolResultBlockParam!(
      {
        questions: [],
        answers: { 'Q1?': 'Yes' },
        annotations: { 'Q1?': { notes: 'because reasons' } },
      } as never,
      'tool-use-1',
    )
    expect(block.tool_use_id).toBe('tool-use-1')
    expect(block.content).toContain('"Q1?"="Yes"')
    expect(block.content).toContain('user notes: because reasons')
  })
})
