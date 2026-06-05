import { useEffect, useState } from "react";
import { SPINNER_FRAMES } from "./figures";

/** Which spinner-frame index is active at `elapsedMs` (pure, wraps). */
export function frameAt(
  elapsedMs: number,
  frameCount: number,
  intervalMs: number,
): number {
  if (frameCount <= 0 || intervalMs <= 0) return 0;
  const clamped = Math.max(0, elapsedMs);
  return (Math.floor(clamped / intervalMs) % frameCount + frameCount) % frameCount;
}

/** The current pulsing-asterisk glyph, advancing on an interval. */
export function useSpinnerFrame(intervalMs = 120): string {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (intervalMs <= 0) return;
    const id = setInterval(() => {
      setIndex((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return SPINNER_FRAMES[index]!;
}
