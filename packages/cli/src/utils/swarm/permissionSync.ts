// TODO: swarm sandbox-permission sync — relays sandbox approvals between a
// swarm leader and workers over the mailbox. Swarm is not ported, so there is
// never a worker and these are inert.

export function isSwarmWorker(..._args: unknown[]): boolean {
  return false
}

export function generateSandboxRequestId(..._args: unknown[]): string {
  return ''
}

export async function sendSandboxPermissionRequestViaMailbox(
  ..._args: unknown[]
): Promise<boolean> {
  return false
}

export function sendSandboxPermissionResponseViaMailbox(
  ..._args: unknown[]
): void {}
