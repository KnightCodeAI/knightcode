// TODO: API request analytics land with the telemetry decision; the log
// hooks are inert but keep their call shapes. EMPTY_USAGE lives in
// emptyUsage.ts and re-exports here for compatibility with upstream imports.

export { EMPTY_USAGE } from './emptyUsage.js'
export type { NonNullableUsage } from '../../entrypoints/sdk/sdkUtilityTypes.js'

export type GlobalCacheStrategy = 'tool_based' | 'system_prompt' | 'none'

export function logAPIQuery(_args: { [key: string]: unknown }): void {}

export function logAPIError(_args: { [key: string]: unknown }): void {}

export function logAPISuccessAndDuration(_args: {
  [key: string]: unknown
}): void {}
