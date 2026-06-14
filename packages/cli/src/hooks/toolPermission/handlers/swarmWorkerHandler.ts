// TODO: swarm-worker permission handling (classifier auto-approval, forwarding
// requests to the leader over the mailbox) lands with the swarm subsystem. Solo
// mode is never a swarm worker, so this resolves nothing and the flow falls
// through to the interactive dialog.

export async function handleSwarmWorkerPermission(_args: unknown): Promise<any> {
  return null
}
