import { z } from 'zod/v4';
import { lazySchema } from '../utils/lazySchema.js';
import { HOOK_EVENTS } from '../entrypoints/sdk/coreTypes.js';
import { SHELL_TYPES } from '../utils/shell/shellProvider.js';
import type { HookEvent } from '../types/hooks.js';

// Shared schema for the `if` condition field. Uses permission rule syntax
// (e.g., "Bash(git *)", "Read(*.ts)") to filter hooks before spawning.
const IfConditionSchema = lazySchema(() =>
  z
    .string()
    .optional()
    .describe(
      'Permission rule syntax to filter when this hook runs (e.g., "Bash(git *)"). ' +
        'Only runs if the tool call matches the pattern.',
    ),
);

// Internal factory for the individual hook-command schemas.
function buildHookSchemas() {
  const BashCommandHookSchema = z.object({
    type: z.literal('command').describe('Shell command hook type'),
    command: z.string().describe('Shell command to execute'),
    if: IfConditionSchema(),
    shell: z
      .enum(SHELL_TYPES)
      .optional()
      .describe(
        "Shell interpreter. 'bash' uses your $SHELL; 'powershell' uses pwsh. Defaults to bash.",
      ),
    timeout: z
      .number()
      .positive()
      .optional()
      .describe('Timeout in seconds for this specific command'),
    statusMessage: z
      .string()
      .optional()
      .describe('Custom status message to display in spinner while hook runs'),
    once: z
      .boolean()
      .optional()
      .describe('If true, hook runs once and is removed after execution'),
    async: z
      .boolean()
      .optional()
      .describe('If true, hook runs in background without blocking'),
    asyncRewake: z
      .boolean()
      .optional()
      .describe(
        'If true, hook runs in background and wakes the model on exit code 2 (blocking error). Implies async.',
      ),
  });

  const PromptHookSchema = z.object({
    type: z.literal('prompt').describe('LLM prompt hook type'),
    prompt: z
      .string()
      .describe(
        'Prompt to evaluate with LLM. Use $ARGUMENTS placeholder for hook input JSON.',
      ),
    if: IfConditionSchema(),
    timeout: z
      .number()
      .positive()
      .optional()
      .describe('Timeout in seconds for this specific prompt evaluation'),
    model: z
      .string()
      .optional()
      .describe(
        'Model to use for this prompt hook. If not specified, uses the default small fast model.',
      ),
    statusMessage: z
      .string()
      .optional()
      .describe('Custom status message to display in spinner while hook runs'),
    once: z
      .boolean()
      .optional()
      .describe('If true, hook runs once and is removed after execution'),
  });

  const HttpHookSchema = z.object({
    type: z.literal('http').describe('HTTP hook type'),
    url: z.string().url().describe('URL to POST the hook input JSON to'),
    if: IfConditionSchema(),
    timeout: z
      .number()
      .positive()
      .optional()
      .describe('Timeout in seconds for this specific request'),
    headers: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'Additional headers to include in the request. Values may reference env vars via $VAR_NAME; only names in allowedEnvVars are interpolated.',
      ),
    allowedEnvVars: z
      .array(z.string())
      .optional()
      .describe(
        'Explicit list of environment variable names that may be interpolated in header values.',
      ),
    statusMessage: z
      .string()
      .optional()
      .describe('Custom status message to display in spinner while hook runs'),
    once: z
      .boolean()
      .optional()
      .describe('If true, hook runs once and is removed after execution'),
  });

  const AgentHookSchema = z.object({
    type: z.literal('agent').describe('Agentic verifier hook type'),
    // DO NOT add .transform() here — parseSettingsFile round-trips the parsed
    // result through JSON.stringify, which would silently drop a transformed
    // function value and delete the user's prompt from settings.json.
    prompt: z
      .string()
      .describe(
        'Prompt describing what to verify. Use $ARGUMENTS placeholder for hook input JSON.',
      ),
    if: IfConditionSchema(),
    timeout: z
      .number()
      .positive()
      .optional()
      .describe('Timeout in seconds for agent execution (default 60)'),
    model: z
      .string()
      .optional()
      .describe('Model to use for this agent hook. If not specified, uses Haiku.'),
    statusMessage: z
      .string()
      .optional()
      .describe('Custom status message to display in spinner while hook runs'),
    once: z
      .boolean()
      .optional()
      .describe('If true, hook runs once and is removed after execution'),
  });

  return {
    BashCommandHookSchema,
    PromptHookSchema,
    HttpHookSchema,
    AgentHookSchema,
  };
}

// Schema for a hook command (excludes function hooks — they can't be persisted).
export const HookCommandSchema = lazySchema(() => {
  const {
    BashCommandHookSchema,
    PromptHookSchema,
    AgentHookSchema,
    HttpHookSchema,
  } = buildHookSchemas();
  return z.discriminatedUnion('type', [
    BashCommandHookSchema,
    PromptHookSchema,
    AgentHookSchema,
    HttpHookSchema,
  ]);
});

// Schema for a matcher configuration with multiple hooks.
export const HookMatcherSchema = lazySchema(() =>
  z.object({
    matcher: z
      .string()
      .optional()
      .describe('String pattern to match (e.g. tool names like "Write")'),
    hooks: z
      .array(HookCommandSchema())
      .describe('List of hooks to execute when the matcher matches'),
  }),
);

// Schema for the hooks configuration: event name → array of matcher configs.
export const HooksSchema = lazySchema(() =>
  z.partialRecord(z.enum(HOOK_EVENTS), z.array(HookMatcherSchema())),
);

export type HookShell = 'bash' | 'powershell' | 'sh';

export type BashCommandHook = {
  type: 'command';
  command: string;
  if?: string;
  shell?: HookShell;
  timeout?: number;
  statusMessage?: string;
  once?: boolean;
  async?: boolean;
  asyncRewake?: boolean;
};

export type PromptHook = {
  type: 'prompt';
  prompt: string;
  if?: string;
  timeout?: number;
  model?: string;
  statusMessage?: string;
  once?: boolean;
};

export type HttpHook = {
  type: 'http';
  url: string;
  if?: string;
  timeout?: number;
  headers?: Record<string, string>;
  allowedEnvVars?: string[];
  statusMessage?: string;
  once?: boolean;
};

export type AgentHook = {
  type: 'agent';
  prompt: string;
  if?: string;
  timeout?: number;
  model?: string;
  statusMessage?: string;
  once?: boolean;
};

export type HookCommand = BashCommandHook | PromptHook | HttpHook | AgentHook;

export type HookMatcher = {
  matcher?: string;
  hooks: HookCommand[];
};

export type HooksSettings = Partial<Record<HookEvent, HookMatcher[]>>;
