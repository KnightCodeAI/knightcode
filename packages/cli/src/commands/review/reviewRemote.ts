// TODO: ultrareview runs the review in the cloud (remote agent + Extra Usage
// billing), which is out of scope for a local BYOK build. The overage gate
// reports the feature as unavailable, so /ultrareview never launches.
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.js'
import type { ToolUseContext } from '../../Tool.js'

export type OverageGate =
  | { kind: 'proceed'; billingNote: string }
  | { kind: 'not-enabled' }
  | { kind: 'low-balance'; available: number }
  | { kind: 'needs-confirm' }

export function confirmOverage(): void {}

export async function checkOverageGate(): Promise<OverageGate> {
  return { kind: 'not-enabled' }
}

export async function launchRemoteReview(
  _args: string,
  _context: ToolUseContext,
  _billingNote?: string,
): Promise<ContentBlockParam[] | null> {
  return null
}
