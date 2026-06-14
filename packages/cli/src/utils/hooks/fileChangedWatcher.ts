// Hooks dispatch — including the cwd-change watcher that fires user-configured
// hooks when the shell changes directory — lands in a later phase. Inert until
// then so the shell exec layer can call it unconditionally.

export async function onCwdChangedForHooks(
  _oldCwd: string,
  _newCwd: string,
): Promise<void> {}

// TODO: the env-change footer notifier (a callback the watcher invokes to flash
// a footer notice when a hook reports an environment change) lands with hooks
// dispatch. No watcher fires today, so registering a notifier is inert.
export function setEnvHookNotifier(
  _cb: ((text: string, isError: boolean) => void) | null,
): void {}
