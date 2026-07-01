// Regression test for the live sub-agent progress bug: buildMessageLookups was
// a stub returning empty maps, so the grouped AgentTool view looked up
// progressMessagesByToolUseID by the agent's tool_use id and always got [],
// rendering "0 tool uses / Initializing…" forever even though the agents ran.
//
// The decisive property: progress messages must be indexed by parentToolUseID
// (the Task tool_use id the grouped renderer keys on), not by their own
// per-message toolUseID.

import { describe, expect, test } from 'bun:test'
import type { NormalizedMessage } from '../types/message.js'
import { buildMessageLookups, createProgressMessage } from './messages.js'

function assistantWithToolUses(
  messageId: string,
  toolUseIds: string[],
): NormalizedMessage {
  return {
    type: 'assistant',
    message: {
      id: messageId,
      role: 'assistant',
      content: toolUseIds.map(id => ({
        type: 'tool_use',
        id,
        name: 'Task',
        input: {},
      })),
    },
    uuid: `uuid-${messageId}`,
  } as unknown as NormalizedMessage
}

function toolResult(toolUseId: string, isError = false): NormalizedMessage {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: 'ok',
          is_error: isError,
        },
      ],
    },
    uuid: `uuid-result-${toolUseId}`,
  } as unknown as NormalizedMessage
}

function agentProgress(parentToolUseId: string, i: number): NormalizedMessage {
  return createProgressMessage({
    toolUseID: `agent_msg_${i}`,
    parentToolUseID: parentToolUseId,
    data: {
      type: 'agent_progress',
      message: {
        type: 'assistant',
        message: { id: `m${i}`, role: 'assistant', content: [] },
        uuid: `p-${i}`,
      },
    } as unknown as Parameters<typeof createProgressMessage>[0]['data'],
  }) as unknown as NormalizedMessage
}

describe('buildMessageLookups', () => {
  test('indexes progress messages by parentToolUseID (the grouped-agent key)', () => {
    const assistant = assistantWithToolUses('asst1', ['task_1', 'task_2'])
    const normalized: NormalizedMessage[] = [
      assistant,
      agentProgress('task_1', 1),
      agentProgress('task_1', 2),
      agentProgress('task_2', 3),
    ]
    const lookups = buildMessageLookups(normalized, [assistant])

    // The bug: stub returned an empty map, so .get(taskId) was undefined.
    expect(lookups.progressMessagesByToolUseID.get('task_1')).toHaveLength(2)
    expect(lookups.progressMessagesByToolUseID.get('task_2')).toHaveLength(1)
  })

  test('builds sibling, tool-use, tool-result, and resolved/errored lookups', () => {
    const assistant = assistantWithToolUses('asst1', ['task_1', 'task_2'])
    const ok = toolResult('task_1', false)
    const bad = toolResult('task_2', true)
    const normalized: NormalizedMessage[] = [assistant, ok, bad]
    const lookups = buildMessageLookups(normalized, [assistant])

    // Siblings: each tool use sees both ids from the same assistant message.
    expect([...(lookups.siblingToolUseIDs.get('task_1') ?? [])].sort()).toEqual([
      'task_1',
      'task_2',
    ])
    // Tool-use blocks indexed by id.
    expect(lookups.toolUseByToolUseID.get('task_1')?.id).toBe('task_1')
    // Tool results + resolved/errored sets.
    expect(lookups.toolResultByToolUseID.get('task_1')).toBeDefined()
    expect(lookups.resolvedToolUseIDs.has('task_1')).toBe(true)
    expect(lookups.resolvedToolUseIDs.has('task_2')).toBe(true)
    expect(lookups.erroredToolUseIDs.has('task_2')).toBe(true)
    expect(lookups.erroredToolUseIDs.has('task_1')).toBe(false)
    expect(lookups.normalizedMessageCount).toBe(3)
  })
})
