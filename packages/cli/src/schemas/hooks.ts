import { z } from 'zod/v4';
import { lazySchema } from '../utils/lazySchema.js';

// TODO: hook execution + config schema lands with the hooks subsystem. These are
// permissive inert schemas/types so the settings document parses and the hook
// settings UI compiles.
export const HookCommandSchema = lazySchema(() => z.object({}).passthrough());
export const HookMatcherSchema = lazySchema(() => z.object({}).passthrough());
export const HooksSchema = lazySchema(() => z.record(z.string(), z.array(z.any())));

export type HookCommand = any;
export type HookMatcher = any;
export type AgentHook = any;
export type BashCommandHook = any;
export type HttpHook = any;
export type PromptHook = any;
export type HooksSettings = { [hookEvent: string]: unknown };
