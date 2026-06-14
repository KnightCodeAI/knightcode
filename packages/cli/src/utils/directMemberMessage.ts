// TODO: direct member messaging belongs to the teammate/swarm orchestration
// subsystem and is not wired here.
export type DirectMessageResult =
  | { success: true; recipientName: string }
  | {
      success: false
      error: 'no_team_context' | 'unknown_recipient'
      recipientName?: string
    }

export function parseDirectMemberMessage(
  _input: string,
): { recipientName: string; message: string } | null {
  return null
}

export async function sendDirectMemberMessage(
  _recipientName: string,
  _message: string,
  _teamContext: unknown,
  _writeToMailbox?: unknown,
): Promise<DirectMessageResult> {
  return { success: false, error: 'no_team_context' }
}
