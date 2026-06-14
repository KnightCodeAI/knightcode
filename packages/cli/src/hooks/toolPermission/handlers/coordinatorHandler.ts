// TODO: coordinator-worker permission handling (awaiting automated checks before
// prompting) lands with the coordinator/swarm subsystem. Solo mode never runs as
// a coordinator worker, so this resolves nothing and the flow falls through to
// the interactive dialog.

export async function handleCoordinatorPermission(_args: unknown): Promise<any> {
  return null
}
