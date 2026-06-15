// TODO: the knightcode.raghavseth.in bridge (remote session mirroring) is out of scope.
// These override readers return nothing so bridge sync never engages.
export function getBridgeBaseUrlOverride(): string | undefined {
  return undefined
}

export function getBridgeTokenOverride(): string | undefined {
  return undefined
}
