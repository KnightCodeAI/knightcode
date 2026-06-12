// TODO: remote feature flags are not wired up; every gate evaluates to its
// default so ported call sites keep working unchanged.

export function checkStatsigFeatureGate_CACHED_MAY_BE_STALE(
  _gate: string,
): boolean {
  return false
}

export function getFeatureValue_CACHED_MAY_BE_STALE<T>(
  _feature: string,
  defaultValue: T,
): T {
  return defaultValue
}
