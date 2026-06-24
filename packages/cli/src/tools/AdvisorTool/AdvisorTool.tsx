import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import React from 'react'
import { z } from 'zod/v4'
import { buildTool, type ToolUseContext } from '../../Tool.js'
import { Box, Text } from '../../tui.js'
import {
  ADVISOR_TOOL_INSTRUCTIONS,
  getConfiguredAdvisorModel,
  isClientAdvisorEnabled,
} from '../../utils/advisor.js'
import { normalizeMessagesForAPI } from '../../utils/messages.js'
import { sideQuery } from '../../utils/sideQuery.js'
import {
  ADVISOR_DESCRIPTION,
  ADVISOR_REVIEWER_SYSTEM_PROMPT,
  buildAdvisorUserPrompt,
} from './prompt.js'

export const ADVISOR_TOOL_NAME = 'advisor'

// The advisor reviewer is given the most-recent slice of the conversation.
// Older turns are dropped (oldest-first) so we stay well under the reviewer
// model's context limit while keeping the freshest, most relevant context.
const MAX_TRANSCRIPT_CHARS = 120_000
const MAX_TOOL_RESULT_CHARS = 4_000
const MAX_TOOL_INPUT_CHARS = 2_000
const ADVISOR_MAX_TOKENS = 4_096

const inputSchema = z.object({})

type AdvisorOutput = {
  advice: string
  model: string
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`
}

function serializeBlock(block: ContentBlockParam): string {
  switch (block.type) {
    case 'text':
      return block.text
    case 'tool_use':
      return `[tool call: ${block.name}] ${truncate(
        JSON.stringify(block.input ?? {}),
        MAX_TOOL_INPUT_CHARS,
      )}`
    case 'tool_result': {
      const content = block.content
      const text =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content
                .map(c => (c.type === 'text' ? c.text : `[${c.type}]`))
                .join('\n')
            : ''
      return `[tool result${block.is_error ? ' (error)' : ''}] ${truncate(
        text,
        MAX_TOOL_RESULT_CHARS,
      )}`
    }
    case 'image':
      return '[image]'
    case 'document':
      return '[document]'
    // Reasoning blocks are intentionally omitted — the advisor reviews the
    // agent's actions and outputs, not its private chain of thought.
    default:
      return ''
  }
}

/** Flatten the live conversation into a plain-text transcript for the reviewer. */
export function serializeTranscript(context: ToolUseContext): string {
  const normalized = normalizeMessagesForAPI(
    context.messages,
    context.options.tools,
  )
  const turns: string[] = []
  for (const msg of normalized) {
    const role = msg.message.role === 'assistant' ? 'Agent' : 'User'
    const content = msg.message.content
    const body =
      typeof content === 'string'
        ? content
        : (content as unknown as ContentBlockParam[])
            .map(serializeBlock)
            .filter(line => line.trim().length > 0)
            .join('\n')
    if (body.trim().length > 0) {
      turns.push(`## ${role}\n${body}`)
    }
  }

  let transcript = turns.join('\n\n')
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    transcript =
      '…[earlier conversation truncated]\n\n' +
      transcript.slice(transcript.length - MAX_TRANSCRIPT_CHARS)
  }
  return transcript
}

function extractAdvice(content: ContentBlockParam[]): string {
  return content
    .filter((b): b is Extract<ContentBlockParam, { type: 'text' }> =>
      Boolean(b.type === 'text'),
    )
    .map(b => b.text)
    .join('\n')
    .trim()
}

export const AdvisorTool = buildTool({
  name: ADVISOR_TOOL_NAME,
  searchHint: 'consult reviewer model for advice',
  inputSchema,
  isEnabled: () => isClientAdvisorEnabled(),
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  maxResultSizeChars: 100_000,
  async description() {
    return ADVISOR_DESCRIPTION
  },
  async prompt() {
    return ADVISOR_TOOL_INSTRUCTIONS
  },
  userFacingName: () => 'Advisor',
  async call(_input, context) {
    const model =
      context.getAppState().advisorModel ?? getConfiguredAdvisorModel()
    if (!model) {
      throw new Error(
        'No advisor model is configured. Run "/advisor <model>" to set one.',
      )
    }

    const transcript = serializeTranscript(context)
    const response = await sideQuery({
      model,
      system: ADVISOR_REVIEWER_SYSTEM_PROMPT,
      skipSystemPromptPrefix: true,
      messages: [
        { role: 'user', content: buildAdvisorUserPrompt(transcript) },
      ],
      max_tokens: ADVISOR_MAX_TOKENS,
      thinking: false,
      signal: context.abortController.signal,
      querySource: 'advisor',
    })

    const advice =
      extractAdvice(response.content as unknown as ContentBlockParam[]) ||
      '(The advisor returned no advice.)'
    return { data: { advice, model } }
  },
  mapToolResultToToolResultBlockParam({ advice }, toolUseID) {
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: advice,
    }
  },
  renderToolUseMessage() {
    return <Text>Consulting advisor…</Text>
  },
  renderToolResultMessage(output: AdvisorOutput) {
    return (
      <Box flexDirection="column">
        <Text dimColor>Advisor ({output.model}):</Text>
        <Text>{output.advice}</Text>
      </Box>
    )
  },
})
