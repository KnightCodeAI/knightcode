// TODO: auto-run /issue — offers to file an issue automatically after a bad
// feedback signal. Tied to the (un-ported) feedback-survey subsystem, so it is
// never triggered.

export type AutoRunIssueReason = string

export function shouldAutoRunIssue(_reason: AutoRunIssueReason): boolean {
  return false
}

export function getAutoRunIssueReasonText(_reason: AutoRunIssueReason): string {
  return ''
}

export function getAutoRunCommand(_reason: AutoRunIssueReason): string {
  return '/issue'
}

export function AutoRunIssueNotification(_props: Record<string, unknown>): null {
  return null
}
