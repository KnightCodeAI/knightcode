// TODO: the teammate mailbox (file-backed inbox for swarm/teammate messaging:
// reading unread messages, marking them read, and the structured protocol
// message predicates) is not implemented yet. The attachment pipeline bridges
// unread mailbox messages into each turn; until the swarm subsystem lands the
// mailbox is always empty and the protocol predicates match nothing.

export type TeammateMessage = {
  from: string
  text: string
  timestamp: string
  read: boolean
  color?: string
  summary?: string
}

export type ShutdownApprovedMessage = {
  type: 'shutdown_approved'
  from: string
}

export type IdleNotificationMessage = {
  type: 'idle_notification'
  from: string
  timestamp: string
  idleReason?: 'available' | 'interrupted' | 'failed'
  summary?: string
  completedTaskId?: string
  completedStatus?: 'resolved' | 'blocked' | 'failed'
  failureReason?: string
}

export async function readUnreadMessages(
  _agentName: string,
  _teamName?: string,
): Promise<TeammateMessage[]> {
  return []
}

export async function markMessagesAsReadByPredicate(
  _agentName: string,
  _predicate: (msg: TeammateMessage) => boolean,
  _teamName?: string,
): Promise<void> {}

export function isShutdownApproved(
  _messageText: string,
): ShutdownApprovedMessage | null {
  return null
}

export function isStructuredProtocolMessage(_messageText: string): boolean {
  return false
}

export function isIdleNotification(
  _messageText: string,
): IdleNotificationMessage | null {
  return null
}

export type PlanApprovalRequestMessage = {
  type: 'plan_approval_request'
  from: string
  planContent: string
  planFilePath: string
}

export type PlanApprovalResponseMessage = {
  type: 'plan_approval_response'
  from: string
  approved: boolean
  feedback?: string
}

export function isPlanApprovalRequest(
  _messageText: string,
): PlanApprovalRequestMessage | null {
  return null
}

export function isPlanApprovalResponse(
  _messageText: string,
): PlanApprovalResponseMessage | null {
  return null
}
