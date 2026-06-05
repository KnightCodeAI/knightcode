/**
 * Verb shimmer helpers, ported from the reference TUI's Spinner
 * (components/Spinner/SpinnerAnimationRow.tsx + GlimmerMessage.tsx).
 */

export type SpinnerMode = "requesting" | "responding" | "tool-use";

/**
 * Column of the bright highlight at `elapsedMs`. A 3-wide highlight sweeps a
 * band of `width + 20` columns, so it travels fully across the word and then
 * pauses off-screen before the next pass:
 *   - "requesting" (awaiting the first token): fast (50ms/col), left → right
 *   - "responding" (streaming):                slower (200ms/col), right → left
 * Returns a far-offscreen value for an empty width.
 */
export function glimmerIndex(
  elapsedMs: number,
  width: number,
  mode: SpinnerMode = "responding",
): number {
  if (width <= 0) return -100;
  const speed = mode === "requesting" ? 50 : 200;
  const cycleLength = width + 20;
  const cyclePosition = Math.floor(Math.max(0, elapsedMs) / speed);
  return mode === "requesting"
    ? (cyclePosition % cycleLength) - 10
    : width + 10 - (cyclePosition % cycleLength);
}

/** Whether column `i` falls inside the ±1 highlight window around `idx`. */
export function inGlimmer(i: number, idx: number): boolean {
  return Math.abs(i - idx) <= 1;
}

/** Sine flash opacity (0..1) for tool-use mode (~2s period). */
export function flashOpacity(elapsedMs: number): number {
  return (Math.sin((Math.max(0, elapsedMs) / 1000) * Math.PI) + 1) / 2;
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  const c = (x: number) =>
    Math.round(Math.min(255, Math.max(0, x)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Mix a #RRGGBB colour toward white by `amt` (0..1) — the shimmer is a lighter base. */
export function lighten(hex: string, amt: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const k = Math.min(1, Math.max(0, amt));
  return toHex(
    rgb[0] + (255 - rgb[0]) * k,
    rgb[1] + (255 - rgb[1]) * k,
    rgb[2] + (255 - rgb[2]) * k,
  );
}

/** Linear interpolate between two #RRGGBB colours (t: 0 → a, 1 → b). */
export function mixColor(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;
  const k = Math.min(1, Math.max(0, t));
  return toHex(
    ca[0] + (cb[0] - ca[0]) * k,
    ca[1] + (cb[1] - ca[1]) * k,
    ca[2] + (cb[2] - ca[2]) * k,
  );
}
