// In a BYOK build there is no subscription, so usage is never billed as a
// subscription "extra usage" overage.
export function isBilledAsExtraUsage(
  _model: string | null,
  _isFastMode: boolean,
  _isOpus1mMerged: boolean,
): boolean {
  return false
}
