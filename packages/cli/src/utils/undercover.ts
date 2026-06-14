// TODO: "undercover" mode is out of scope.
export function isUndercover(): boolean {
  return false
}

export function shouldShowUndercoverAutoNotice(..._args: unknown[]): boolean { return false }
