// Slash-command processing for prompt/skill commands: resolve the command,
// build the meta + content messages (and attachments), and surface the
// allowedTools/model the command grants. The interactive `/command` dispatch
// surface lands with the REPL command UI; this module provides the
// prompt-command expansion the Skill tool drives.
import type { ContentBlockParam, TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { COMMAND_MESSAGE_TAG, COMMAND_NAME_TAG } from '../../constants/xml.js'
import { findCommand } from '../../commands.js'
import { addInvokedSkill, getSessionId } from '../../bootstrap/state.js'
import type {
  Command,
  CommandBase,
  PromptCommand,
} from '../../types/command.js'
import type { ToolUseContext } from '../../Tool.js'
import { MalformedCommandError } from '../errors.js'
import { getAgentContext } from '../agentContext.js'
import { getAttachmentMessages, createAttachmentMessage } from '../attachments.js'
import { toArray } from '../generators.js'
import { registerSkillHooks } from '../hooks/registerSkillHooks.js'
import { createUserMessage } from '../messages.js'
import { parseToolListFromCLI } from '../permissions/permissionSetup.js'
import {
  isRestrictedToPluginOnly,
  isSourceAdminTrusted,
} from '../settings/pluginOnlyPolicy.js'
import type { ProcessUserInputBaseResult } from './processUserInput.js'

export type SlashCommandResult = ProcessUserInputBaseResult & {
  command: Command
}

export async function processSlashCommand(
  ..._args: unknown[]
): Promise<ProcessUserInputBaseResult> {
  return { messages: [], shouldQuery: false }
}

function formatSlashCommandLoadingMetadata(
  commandName: string,
  args?: string,
): string {
  return [
    `<${COMMAND_MESSAGE_TAG}>${commandName}</${COMMAND_MESSAGE_TAG}>`,
    `<${COMMAND_NAME_TAG}>/${commandName}</${COMMAND_NAME_TAG}>`,
    args ? `<command-args>${args}</command-args>` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

export function formatSkillLoadingMetadata(
  skillName: string,
  _progressMessage: string = 'loading',
): string {
  // Use skill name only - UserCommandMessage renders as "Skill(name)"
  return [
    `<${COMMAND_MESSAGE_TAG}>${skillName}</${COMMAND_MESSAGE_TAG}>`,
    `<${COMMAND_NAME_TAG}>${skillName}</${COMMAND_NAME_TAG}>`,
    `<skill-format>true</skill-format>`,
  ].join('\n')
}

function formatCommandLoadingMetadata(
  command: CommandBase & PromptCommand,
  args?: string,
): string {
  // User-invocable skills show as /command-name like regular slash commands.
  if (command.userInvocable !== false) {
    return formatSlashCommandLoadingMetadata(command.name, args)
  }
  // Model-only skills (userInvocable: false) show as "The X skill is running".
  if (
    command.loadedFrom === 'skills' ||
    command.loadedFrom === 'plugin' ||
    command.loadedFrom === 'mcp'
  ) {
    return formatSkillLoadingMetadata(command.name, command.progressMessage)
  }
  return formatSlashCommandLoadingMetadata(command.name, args)
}

export async function processPromptSlashCommand(
  commandName: string,
  args: string,
  commands: Command[],
  context: ToolUseContext,
  imageContentBlocks: ContentBlockParam[] = [],
): Promise<SlashCommandResult> {
  const command = findCommand(commandName, commands)
  if (!command) {
    throw new MalformedCommandError(`Unknown command: ${commandName}`)
  }
  if (command.type !== 'prompt') {
    throw new Error(
      `Unexpected ${command.type} command. Expected 'prompt' command. Use /${commandName} directly in the main conversation.`,
    )
  }
  return getMessagesForPromptSlashCommand(command, args, context, [], imageContentBlocks)
}

async function getMessagesForPromptSlashCommand(
  command: CommandBase & PromptCommand,
  args: string,
  context: ToolUseContext,
  precedingInputBlocks: ContentBlockParam[] = [],
  imageContentBlocks: ContentBlockParam[] = [],
  uuid?: string,
): Promise<SlashCommandResult> {
  const result = await command.getPromptForCommand(args, context)

  // Register skill hooks if defined. Block hook REGISTRATION for user skills
  // when locked to plugin-only; admin-trusted sources still load.
  const hooksAllowedForThisSkill =
    !isRestrictedToPluginOnly('hooks') || isSourceAdminTrusted(command.source)
  if (command.hooks && hooksAllowedForThisSkill) {
    const sessionId = getSessionId()
    registerSkillHooks(
      context.setAppState,
      sessionId,
      command.hooks,
      command.name,
      command.type === 'prompt' ? command.skillRoot : undefined,
    )
  }

  // Record skill invocation for compaction preservation, scoped by agent.
  const skillPath = command.source
    ? `${command.source}:${command.name}`
    : command.name
  const skillContent = result
    .filter((b): b is TextBlockParam => b.type === 'text')
    .map(b => b.text)
    .join('\n\n')
  addInvokedSkill(
    command.name,
    skillPath,
    skillContent,
    getAgentContext()?.agentId ?? null,
  )
  const metadata = formatCommandLoadingMetadata(command, args)
  const additionalAllowedTools = parseToolListFromCLI(command.allowedTools ?? [])

  const mainMessageContent: ContentBlockParam[] =
    imageContentBlocks.length > 0 || precedingInputBlocks.length > 0
      ? [...imageContentBlocks, ...precedingInputBlocks, ...result]
      : result

  // Extract attachments from the resolved skill content. skipSkillDiscovery
  // prevents the SKILL.md content itself from triggering discovery.
  const attachmentMessages = await toArray(
    getAttachmentMessages(
      result
        .filter((block): block is TextBlockParam => block.type === 'text')
        .map(block => block.text)
        .join(' '),
      context,
      null,
      [],
      context.messages,
      'repl_main_thread',
      { skipSkillDiscovery: true },
    ),
  )
  const messages = [
    createUserMessage({ content: metadata, uuid }),
    createUserMessage({ content: mainMessageContent, isMeta: true }),
    ...attachmentMessages,
    createAttachmentMessage({
      type: 'command_permissions',
      allowedTools: additionalAllowedTools,
      model: command.model,
    }),
  ]
  return {
    messages,
    shouldQuery: true,
    allowedTools: additionalAllowedTools,
    model: command.model,
    effort: command.effort,
    command,
  }
}
