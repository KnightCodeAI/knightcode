// TODO: inter-session peer IPC is not ported to this build.
export async function postInterSessionMessage(
  _target: string,
  _message: string,
): Promise<{ ok: false; error: string }> {
  return { ok: false, error: 'Peer sessions are not supported in this build.' }
}
