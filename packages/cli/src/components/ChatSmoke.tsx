import React, { useRef, useState } from 'react'
import { getEmptyToolPermissionContext } from '../Tool.js'
import {
  queryModelWithStreaming,
  type Options,
} from '../services/api/claude.js'
import { Box, Text, useApp } from '../tui.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import ScrollBox from '../tui/components/ScrollBox.js'
import type {
  AssistantMessage,
  StreamEvent,
  UserMessage,
} from '../types/message.js'
import { createUserMessage } from '../utils/messages.js'
import { asSystemPrompt } from '../utils/systemPromptType.js'
import { useSearchInput } from '../hooks/useSearchInput.js'
import { SearchBox } from './SearchBox.js'

// TODO: replaced by the real REPL when the harness lands. This screen
// exists to prove the model seam end-to-end: prompt in, tokens streaming
// out, history carried across turns.

const SMOKE_MODEL = 'anthropic/claude-3.5-haiku'

const SMOKE_SYSTEM_PROMPT = asSystemPrompt([
  'You are a helpful assistant running inside a terminal chat.',
])

type Row = {
  role: 'user' | 'assistant' | 'error'
  text: string
}

function queryOptions(): Options {
  return {
    getToolPermissionContext: async () => getEmptyToolPermissionContext(),
    model: SMOKE_MODEL,
    isNonInteractiveSession: false,
    querySource: 'repl_main_thread',
    agents: [],
    hasAppendSystemPrompt: false,
    mcpTools: [],
  }
}

export function ChatSmoke(): React.ReactNode {
  const { exit } = useApp()
  const { rows: terminalRows } = useTerminalSize()
  const [transcript, setTranscript] = useState<Row[]>([])
  const [streamingText, setStreamingText] = useState<string | null>(null)
  const [isWorking, setIsWorking] = useState(false)
  const historyRef = useRef<(UserMessage | AssistantMessage)[]>([])

  const { query, setQuery, cursorOffset } = useSearchInput({
    isActive: !isWorking,
    onExit: () => void submit(),
    onCancel: () => exit(),
    backspaceExitsOnEmpty: false,
  })

  async function submit(): Promise<void> {
    const prompt = query.trim()
    if (!prompt || isWorking) return
    setQuery('')
    setTranscript(prev => [...prev, { role: 'user', text: prompt }])
    setIsWorking(true)
    setStreamingText('')

    const userMessage = createUserMessage({ content: prompt })
    historyRef.current.push(userMessage)

    let streamed = ''
    try {
      const generator = queryModelWithStreaming({
        messages: [...historyRef.current],
        systemPrompt: SMOKE_SYSTEM_PROMPT,
        thinkingConfig: { type: 'disabled' },
        tools: [],
        signal: new AbortController().signal,
        options: queryOptions(),
      })

      for await (const message of generator) {
        if (message.type === 'stream_event') {
          const event = (message as StreamEvent).event
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            streamed += event.delta.text
            setStreamingText(streamed)
          }
          continue
        }
        if (message.type === 'assistant') {
          const assistant = message as AssistantMessage
          historyRef.current.push(assistant)
          const text = assistant.message.content
            .map(block => (block.type === 'text' ? block.text : ''))
            .join('')
          setTranscript(prev => [...prev, { role: 'assistant', text }])
          continue
        }
        if (message.type === 'system' && message.subtype === 'api_error') {
          setTranscript(prev => [
            ...prev,
            {
              role: 'error',
              text: `${message.error.message} (retry ${message.retryAttempt}/${message.maxRetries})`,
            },
          ])
        }
      }
    } catch (error) {
      setTranscript(prev => [
        ...prev,
        {
          role: 'error',
          text: error instanceof Error ? error.message : String(error),
        },
      ])
    } finally {
      setStreamingText(null)
      setIsWorking(false)
    }
  }

  return (
    <Box flexDirection="column" width="100%" height={terminalRows}>
      <ScrollBox flexGrow={1} stickyScroll>
        <Box flexDirection="column" paddingX={1}>
          {transcript.map((row, i) => (
            <Box key={i} marginBottom={1} flexDirection="column">
              <Text
                bold
                color={
                  row.role === 'user'
                    ? 'suggestion'
                    : row.role === 'error'
                      ? 'error'
                      : undefined
                }
              >
                {row.role === 'user'
                  ? '> you'
                  : row.role === 'error'
                    ? '! error'
                    : '· model'}
              </Text>
              <Text>{row.text}</Text>
            </Box>
          ))}
          {streamingText !== null && (
            <Box marginBottom={1} flexDirection="column">
              <Text bold>· model</Text>
              <Text>{streamingText.length > 0 ? streamingText : '…'}</Text>
            </Box>
          )}
        </Box>
      </ScrollBox>
      <SearchBox
        query={query}
        cursorOffset={cursorOffset}
        placeholder={isWorking ? 'waiting for the model…' : 'Type a message (esc to quit)'}
        isFocused={!isWorking}
        isTerminalFocused
        prefix=">"
      />
    </Box>
  )
}

export function MissingKeyNotice(): React.ReactNode {
  const { exit } = useApp()
  setTimeout(exit, 50)
  return (
    <Box borderStyle="round" flexDirection="column" paddingX={1}>
      <Text bold>knightcode</Text>
      <Text>
        No API key found. Set OPENROUTER_API_KEY or add one to
        ~/.knightcode/credentials.json.
      </Text>
    </Box>
  )
}
