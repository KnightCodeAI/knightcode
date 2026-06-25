// Critical system constants extracted to break circular dependencies

import { getAPIProvider } from "../utils/model/providers.js";

const DEFAULT_PREFIX = `You are KnightCode, An open source CLI.`;
const AGENT_SDK_KNIGHTCODE_CODE_PRESET_PREFIX = `You are KnightCode, running within the KnightCode Agent SDK.`;
const AGENT_SDK_PREFIX = `You are a KnightCode agent, built on KnightCode's KnightCode Agent SDK.`;

const CLI_SYSPROMPT_PREFIX_VALUES = [
  DEFAULT_PREFIX,
  AGENT_SDK_KNIGHTCODE_CODE_PRESET_PREFIX,
  AGENT_SDK_PREFIX,
] as const;

export type CLISyspromptPrefix = (typeof CLI_SYSPROMPT_PREFIX_VALUES)[number];

/**
 * All possible CLI sysprompt prefix values, used by splitSysPromptPrefix
 * to identify prefix blocks by content rather than position.
 */
export const CLI_SYSPROMPT_PREFIXES: ReadonlySet<string> = new Set(
  CLI_SYSPROMPT_PREFIX_VALUES,
);

export function getCLISyspromptPrefix(options?: {
  isNonInteractive: boolean;
  hasAppendSystemPrompt: boolean;
}): CLISyspromptPrefix {
  const apiProvider = getAPIProvider();
  if (apiProvider === "vertex") {
    return DEFAULT_PREFIX;
  }

  if (options?.isNonInteractive) {
    if (options.hasAppendSystemPrompt) {
      return AGENT_SDK_KNIGHTCODE_CODE_PRESET_PREFIX;
    }
    return AGENT_SDK_PREFIX;
  }
  return DEFAULT_PREFIX;
}
