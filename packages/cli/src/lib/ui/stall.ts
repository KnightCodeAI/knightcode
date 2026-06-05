import { useEffect, useRef, useState } from "react";

/** True once `nowMs` is at least `thresholdMs` past the last change. */
export function isStalled(
  lastChangeMs: number,
  nowMs: number,
  thresholdMs = 10000,
): boolean {
  return nowMs - lastChangeMs >= thresholdMs;
}

/**
 * Tracks the last time `signal` changed; returns true when it's been quiet for
 * `thresholdMs`. Used to redden the working row when the model stops producing
 * output (the reference TUI turns the spinner red when a reply stalls).
 *
 * While `active` is true (a tool is running) the clock is pinned to now, so a
 * tool that produces no text never reads as a stall — mirroring the reference TUI's
 * `hasActiveTools` reset. The grace period restarts when the tool finishes.
 */
export function useStall(
  signal: number,
  active = false,
  thresholdMs = 3000,
): boolean {
  const lastChange = useRef(Date.now());
  const prevSignal = useRef(signal);
  const [, force] = useState(0);

  // Re-evaluate on a slow tick; also pin the clock to now while a tool is active.
  useEffect(() => {
    const id = setInterval(() => {
      if (active) lastChange.current = Date.now();
      force((n) => (n + 1) % 1_000_000);
    }, 500);
    return () => clearInterval(id);
  }, [active]);

  // Track signal changes without mutating refs during render.
  useEffect(() => {
    prevSignal.current = signal;
    lastChange.current = Date.now();
  }, [signal]);

  return isStalled(lastChange.current, Date.now(), thresholdMs);
}
