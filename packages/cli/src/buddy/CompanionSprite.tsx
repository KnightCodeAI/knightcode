// TODO: the companion sprite is an easter-egg overlay that is out of scope.
export function companionReservedColumns(
  _terminalColumns: number,
  _speaking: boolean,
): number {
  return 0
}

// TODO: companion sprite is a deferred feature; render nothing.
export const MIN_COLS_FOR_FULL_SPRITE = 100
export function CompanionSprite(_props: Record<string, unknown>): null { return null }
export function CompanionFloatingBubble(_props: Record<string, unknown>): null { return null }
