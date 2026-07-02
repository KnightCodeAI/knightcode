// Headless (`--print`) turn runner. Drives one full agentic turn over the
// shared query() loop without the React TUI, yielding upstream-wire-shaped
// SDKMessages: a `system/init`, one envelope per assistant/user message, and a
// terminal `result`. Mirrors QueryEngine.submitMessage's message-handling
// switch, trimmed of the SDK-daemon / remote-control / suggestion machinery
// that only matters for the long-lived query engine. Task 6 consumes this for
// stdout formatting.

import { getCommands } from 'src/commands.js'
import { getSystemPrompt } from 'src/constants/prompts.js'
import { getUserContext, getSystemContext } from 'src/context.js'
import type { SDKMessage } from 'src/entrypoints/agentSdkTypes.js'
import { query as defaultQuery, type QueryParams } from 'src/query.js'
import {
  getDefaultAppState,
  type AppState,
} from 'src/state/AppStateStore.js'
import { createStore } from 'src/state/store.js'
import { getTools } from 'src/tools.js'
import type { ToolPermissionContext } from 'src/Tool.js'
import type { Message } from 'src/types/message.js'
import type { PermissionMode } from 'src/types/permissions.js'
import { errorMessage } from 'src/utils/errors.js'
import {
  createFileStateCacheWithSizeLimit,
  READ_FILE_STATE_CACHE_SIZE,
} from 'src/utils/fileStateCache.js'
import { createUserMessage } from 'src/utils/messages.js'
import {
  accumulateSdkUsage,
  buildResultMessage,
  EMPTY_SDK_USAGE,
  toSdkEnvelope,
  type Usage,
} from 'src/utils/messages/sdkEnvelopes.js'
import { buildSystemInitMessage } from 'src/utils/messages/systemInit.js'
import {
  getMainLoopModel,
  parseUserSpecifiedModel,
} from 'src/utils/model/model.js'
import { hasPermissionsToUseTool } from 'src/utils/permissions/permissions.js'
import type { ProcessUserInputContext } from 'src/utils/processUserInput/processUserInput.js'
import { recordTranscript } from 'src/utils/sessionStorage.js'
import { buildEffectiveSystemPrompt } from 'src/utils/systemPrompt.js'
import { buildHeadlessPermissionContext } from './headlessPermissions.js'

export type HeadlessTurnOptions = {
  prompt: string
  cwd: string
  model?: string
  permissionMode?: PermissionMode
  dangerouslySkipPermissions: boolean
  allowedTools: string[]
  disallowedTools: string[]
  maxTurns?: number
  systemPrompt?: string
  appendSystemPrompt?: string
  verbose: boolean
  queryFn?: typeof defaultQuery
}

// Reads the four wire usage fields off a raw stream-event usage object,
// defaulting each to 0. The API's usage shapes carry extra fields
// (service_tier, cache_creation, ...) the result envelope doesn't sum.
function readWireUsage(raw: unknown): Usage {
  const u = (raw ?? {}) as Record<string, unknown>
  const num = (v: unknown): number => (typeof v === 'number' ? v : 0)
  return {
    input_tokens: num(u.input_tokens),
    output_tokens: num(u.output_tokens),
    cache_creation_input_tokens: num(u.cache_creation_input_tokens),
    cache_read_input_tokens: num(u.cache_read_input_tokens),
  }
}

// message_delta usage is a partial update over the message_start snapshot
// (typically just output_tokens grows). Overwrite a field only when the delta
// carries a non-zero value so message_start's input/cache counts survive.
function mergeWireUsage(prev: Usage, raw: unknown): Usage {
  const next = readWireUsage(raw)
  return {
    input_tokens: next.input_tokens || prev.input_tokens,
    output_tokens: next.output_tokens || prev.output_tokens,
    cache_creation_input_tokens:
      next.cache_creation_input_tokens || prev.cache_creation_input_tokens,
    cache_read_input_tokens:
      next.cache_read_input_tokens || prev.cache_read_input_tokens,
  }
}

// Last text block of an assistant message, mirroring QueryEngine's result-text
// extraction: only the final content block counts, and only if it's text (a
// turn ending in a tool_use yields no result text).
function lastAssistantText(message: Message): string | null {
  if (message.type !== 'assistant') return null
  const content = message.message.content
  if (!Array.isArray(content)) {
    return typeof content === 'string' ? content : null
  }
  const last = content[content.length - 1]
  if (last && typeof last === 'object' && 'type' in last && last.type === 'text') {
    return (last as { text: string }).text
  }
  return null
}

/**
 * Builds a React-free ProcessUserInputContext for the query loop. Modeled on
 * REPL's getToolUseContext (screens/REPL.tsx): the same `options` block with
 * `isNonInteractiveSession: true`, a `refreshTools` that recomputes from the
 * store, and no-op implementations for every UI callback. State reads/writes go
 * through the plain store; `messages`/`setMessages` close over a local array.
 */
function buildHeadlessToolUseContext(args: {
  store: ReturnType<typeof createStore<AppState>>
  permissionContext: ToolPermissionContext
  commands: Awaited<ReturnType<typeof getCommands>>
  model: string
  verbose: boolean
  messages: Message[]
  abortController: AbortController
}): ProcessUserInputContext {
  const { store, permissionContext, commands, model, verbose, messages } = args

  const refreshTools = () => getTools(store.getState().toolPermissionContext)

  return {
    abortController: args.abortController,
    options: {
      commands,
      tools: getTools(permissionContext),
      debug: false,
      verbose,
      mainLoopModel: model,
      thinkingConfig:
        store.getState().thinkingEnabled !== false
          ? { type: 'adaptive' }
          : { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: true,
      agentDefinitions: store.getState().agentDefinitions,
      refreshTools,
      // LocalJSXCommandContext options — headless has no IDE integration or
      // theme surface, so these are inert defaults.
      ideInstallationStatus: null,
      theme: 'dark',
    },
    getAppState: () => store.getState(),
    setAppState: f => store.setState(f),
    updateFileHistoryState: updater => {
      store.setState(prev => {
        const updated = updater(prev.fileHistory)
        if (updated === prev.fileHistory) return prev
        return { ...prev, fileHistory: updated }
      })
    },
    updateAttributionState: updater => {
      store.setState(prev => {
        const updated = updater(prev.attribution)
        if (updated === prev.attribution) return prev
        return { ...prev, attribution: updated }
      })
    },
    messages,
    setMessages: updater => {
      const next = updater(messages)
      if (next === messages) return
      messages.length = 0
      messages.push(...next)
    },
    readFileState: createFileStateCacheWithSizeLimit(READ_FILE_STATE_CACHE_SIZE),
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    // No-op UI callbacks — nothing renders in headless mode.
    setToolJSX: () => {},
    addNotification: () => {},
    appendSystemMessage: () => {},
    openMessageSelector: () => {},
    sendOSNotification: () => {},
    onInstallIDEExtension: () => {},
    onChangeAPIKey: () => {},
    nestedMemoryAttachmentTriggers: new Set<string>(),
    loadedNestedMemoryPaths: new Set<string>(),
    dynamicSkillDirTriggers: new Set<string>(),
    discoveredSkillNames: new Set<string>(),
  }
}

/**
 * Runs one headless agentic turn and yields upstream-wire-shaped SDKMessages.
 *
 * Never throws for turn-level failures: any error thrown by the query loop is
 * converted into an `error_during_execution` result envelope so `--print`
 * callers always receive a terminal `result` message.
 */
export async function* runHeadlessTurn(
  opts: HeadlessTurnOptions,
): AsyncGenerator<SDKMessage> {
  const startTime = Date.now()
  const queryFn = opts.queryFn ?? defaultQuery

  // Transcript of yielded assistant/user messages, seeded with the user's
  // prompt. Kept separate from the array handed to query() so query()'s
  // internal state mutations can't alias what we record.
  const transcript: Message[] = [createUserMessage({ content: opts.prompt })]

  let turnCount = 0
  let usage: Usage = EMPTY_SDK_USAGE
  let currentMessageUsage: Usage = EMPTY_SDK_USAGE
  let stopReason: string | null = null
  let resultText = ''

  try {
    const permissionContext = buildHeadlessPermissionContext({
      permissionMode: opts.permissionMode,
      dangerouslySkipPermissions: opts.dangerouslySkipPermissions,
      allowedTools: opts.allowedTools,
      disallowedTools: opts.disallowedTools,
    })

    const model = opts.model
      ? parseUserSpecifiedModel(opts.model)
      : getMainLoopModel()

    const store = createStore<AppState>({
      ...getDefaultAppState(),
      verbose: opts.verbose,
      mainLoopModel: model,
      toolPermissionContext: permissionContext,
    })

    const tools = getTools(permissionContext)
    const commands = await getCommands(opts.cwd)

    const abortController = new AbortController()
    const toolUseContext = buildHeadlessToolUseContext({
      store,
      permissionContext,
      commands,
      model,
      verbose: opts.verbose,
      messages: transcript,
      abortController,
    })

    // System prompt: opts.systemPrompt replaces the default; appendSystemPrompt
    // is appended. buildEffectiveSystemPrompt applies the exact same replace/
    // append semantics the REPL uses.
    const defaultSystemPrompt = await getSystemPrompt(tools, model, undefined, [])
    const systemPrompt = buildEffectiveSystemPrompt({
      mainThreadAgentDefinition: undefined,
      toolUseContext,
      customSystemPrompt: opts.systemPrompt,
      defaultSystemPrompt,
      appendSystemPrompt: opts.appendSystemPrompt,
    })

    yield buildSystemInitMessage({
      tools,
      mcpClients: [],
      model,
      permissionMode: permissionContext.mode,
      commands,
      agents: [],
      skills: [],
      plugins: [],
      fastMode: undefined,
    })

    const [userContext, systemContext] = await Promise.all([
      getUserContext(),
      getSystemContext(),
    ])

    const params: QueryParams = {
      messages: [...transcript],
      systemPrompt,
      userContext,
      systemContext,
      canUseTool: hasPermissionsToUseTool,
      toolUseContext,
      querySource: 'sdk',
      maxTurns: opts.maxTurns,
    }

    for await (const message of queryFn(params)) {
      switch (message.type) {
        case 'assistant': {
          if (message.message.stop_reason != null) {
            stopReason = message.message.stop_reason
          }
          const text = lastAssistantText(message)
          if (text != null) resultText = text
          transcript.push(message)
          const envelope = toSdkEnvelope(message)
          if (envelope) yield envelope
          break
        }
        case 'user': {
          turnCount++
          transcript.push(message)
          const envelope = toSdkEnvelope(message)
          if (envelope) yield envelope
          break
        }
        case 'stream_event': {
          const event = message.event
          if (event.type === 'message_start') {
            currentMessageUsage = readWireUsage(event.message.usage)
          } else if (event.type === 'message_delta') {
            currentMessageUsage = mergeWireUsage(
              currentMessageUsage,
              event.usage,
            )
            if (event.delta.stop_reason != null) {
              stopReason = event.delta.stop_reason
            }
          } else if (event.type === 'message_stop') {
            usage = accumulateSdkUsage(usage, currentMessageUsage)
            currentMessageUsage = EMPTY_SDK_USAGE
          }
          break
        }
        case 'attachment': {
          if (message.attachment.type === 'max_turns_reached') {
            yield buildResultMessage({
              subtype: 'error_max_turns',
              startTime,
              numTurns: message.attachment.turnCount,
              resultText,
              usage,
              stopReason,
              errors: [
                `Reached maximum number of turns (${message.attachment.maxTurns})`,
              ],
            })
            return
          }
          break
        }
        default:
          // tombstone / stream_request_start / progress / system /
          // tool_use_summary — local bookkeeping, never on the SDK wire.
          break
      }
    }

    // Best-effort transcript persistence — a session-storage failure must not
    // turn a successful turn into an error.
    try {
      await recordTranscript(transcript)
    } catch {
      // ignore
    }

    yield buildResultMessage({
      subtype: 'success',
      startTime,
      numTurns: turnCount,
      resultText,
      usage,
      stopReason,
    })
  } catch (err) {
    yield buildResultMessage({
      subtype: 'error_during_execution',
      startTime,
      numTurns: turnCount,
      resultText,
      usage,
      stopReason,
      errors: [errorMessage(err)],
    })
  }
}
