// TODO: remote-control bridge config — owned by the claude.ai remote-control
// feature. Local-only build never surfaces the bridge upgrade prompt.
export async function shouldShowAppUpgradeMessage(): Promise<boolean> {
  return false
}
