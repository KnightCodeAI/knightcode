// TODO: Anthropic rate-limit message detection is out of scope (BYOK has no
// hosted rate-limit surface). Nothing is ever a rate-limit error message.
export function isRateLimitErrorMessage(_text: string): boolean {
  return false
}
