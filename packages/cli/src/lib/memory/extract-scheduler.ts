import { debugLog } from "../debug";
import { extractMemories } from "./extract";
import { maybeRunConsolidation } from "./auto-dream";
import type { Message } from "../engine/messages";

type ExtractionParams = {
  messages: Message[];
  cwd: string;
  mainModelId: string;
  sessionId?: string;
  getApiKey?: () => string | undefined;
};

/**
 * Serializes memory extraction so two forked agents never run at once (they'd
 * scan the same manifest and race on Memory writes + the MEMORY.md regen):
 * at most one run in flight, plus a single coalesced trailing run for the
 * latest context that arrived while a run was active (intermediate contexts
 * are superseded).
 */
let inFlight = false;
let pending: { params: ExtractionParams; onSaved?: (n: number) => void } | null =
  null;
/** The promise for the currently-executing run, or null when idle. A coalesced
 *  trailing run replaces this in the run's `finally`, so awaiting to completion
 *  means looping until it settles to null. */
let activeRun: Promise<void> | null = null;

/** Test seam: the extractor invoked per run (defaults to the real one). */
let extractor: (p: ExtractionParams) => Promise<number> = extractMemories;

export function scheduleMemoryExtraction(
  params: ExtractionParams,
  onSaved?: (count: number) => void,
): void {
  if (inFlight) {
    // A run is active - stash the latest context for one trailing run; a newer
    // context supersedes an older stashed one (we only ever run one trailing).
    pending = { params, onSaved };
    debugLog("memory.extract", "coalesced - run in flight, stashed latest turn");
    return;
  }
  inFlight = true;
  activeRun = (async () => {
    try {
      const n = await extractor(params);
      if (n > 0) onSaved?.(n);
      // Consolidation runs in the same serialized slot as extraction so the two
      // forked agents never overlap (both write memory). It self-gates on
      // time/session thresholds, so this is a cheap no-op on most turns.
      await maybeRunConsolidation({
        cwd: params.cwd,
        mainModelId: params.mainModelId,
        getApiKey: params.getApiKey,
      }).catch(() => 0);
    } catch (err) {
      console.error("Memory extraction error:", err);
    } finally {
      inFlight = false;
      const next = pending;
      pending = null;
      // Reschedule reassigns activeRun to the trailing run; otherwise we go idle.
      if (next) scheduleMemoryExtraction(next.params, next.onSaved);
      else activeRun = null;
    }
  })();
}

/**
 * Await any in-flight extraction (and its coalesced trailing run) to completion.
 * Resolves immediately when idle. Call on shutdown so a forked extraction agent
 * mid-run isn't dropped. Best-effort — never rejects.
 */
export async function drainMemoryExtraction(): Promise<void> {
  while (activeRun) {
    await activeRun.catch(() => {});
  }
}

/** Test seam: reset state and optionally inject a fake extractor. */
export function __setExtractorForTest(
  fn?: (p: ExtractionParams) => Promise<number>,
): void {
  inFlight = false;
  pending = null;
  activeRun = null;
  extractor = fn ?? extractMemories;
}
