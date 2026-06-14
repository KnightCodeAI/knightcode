import { z } from 'zod/v4';
import { lazySchema } from '../utils/lazySchema.js';
import type { HookEvent } from '../types/hooks.js';

// TODO: full hook execution (the runners + the lifecycle aggregator) lands with
// the hooks-firing subsystem. The runtime parse schemas stay permissive; the
// types below are the real config shapes so the config/settings/UI layer is
// type-safe.
export const HookCommandSchema = lazySchema(() => z.object({}).passthrough());
export const HookMatcherSchema = lazySchema(() => z.object({}).passthrough());
export const HooksSchema = lazySchema(() => z.record(z.string(), z.array(z.any())));

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
