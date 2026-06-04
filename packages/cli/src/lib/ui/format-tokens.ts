/** Token-count estimate + compact formatting for the working-row counter. */

/** Rough token estimate from a character count (~4 chars/token, like the reference TUI). */
export function estimateTokens(chars: number): number {
  if (chars <= 0) return 0;
  return Math.ceil(chars / 4);
}

/** Compact count: "850", "1.2k", "12k". */
export function formatTokenCount(n: number): string {
  if (n < 1000) return String(Math.max(0, Math.round(n)));
  const k = n / 1000;
  return k >= 10 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
}
