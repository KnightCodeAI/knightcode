// TODO: the claude.ai/code bridge (remote session mirroring) is out of scope.
// Title sync to a bridge session is a no-op.
export async function updateBridgeSessionTitle(
  _sessionId: string,
  _title: string,
  _options: { baseUrl?: string; getAccessToken?: () => string },
): Promise<void> {}
