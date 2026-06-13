// Hooks dispatch — including the cwd-change watcher that fires user-configured
// hooks when the shell changes directory — lands in a later phase. Inert until
// then so the shell exec layer can call it unconditionally.

export async function onCwdChangedForHooks(
  _oldCwd: string,
  _newCwd: string,
): Promise<void> {}
