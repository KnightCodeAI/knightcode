import type { Message } from "./messages";

export type ContextProviderArgs = {
  /** Transcript so far this turn (ending with the latest user message, plus
   *  the in-progress assistant message on per-round runs). */
  messages: Message[];
  cwd: string;
  /** Embedder session id, when available (per-round providers may need it). */
  sessionId?: string;
  signal?: AbortSignal;
};

/** When a provider runs within a turn. */
export type ContextProviderPhase = "turn_start" | "per_round";

/**
 * A context provider injects zero or more <system-reminder> strings into the
 * request. `turn_start` providers run once before the first response (memory
 * recall). `per_round` providers run after each tool round, so their output is
 * re-primed every round (changed-file reminders, todos, etc.). Providers must
 * not mutate the transcript and must never throw — failures are swallowed so a
 * flaky side model can't break the turn.
 */
export type ContextProvider = {
  phase: ContextProviderPhase;
  run: (args: ContextProviderArgs) => Promise<string[]>;
};

/** Run the providers matching `phase` concurrently; collect non-empty strings. */
export async function runContextProviders(
  providers: readonly ContextProvider[],
  phase: ContextProviderPhase,
  args: ContextProviderArgs,
): Promise<string[]> {
  const selected = providers.filter((p) => p.phase === phase);
  if (selected.length === 0) return [];
  const results = await Promise.all(
    selected.map((p) => p.run(args).catch(() => [] as string[])),
  );
  return results
    .flat()
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0);
}

/**
 * Extract the most recent user message's plain text — the signal recall and
 * discovery providers key off. Joins all text parts; ignores tool/file parts.
 */
export function latestUserText(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "user") continue;
    const text = m.parts
      .filter(
        (p): p is { type: "text"; text: string } =>
          (p as { type?: string }).type === "text" &&
          typeof (p as { text?: unknown }).text === "string",
      )
      .map((p) => p.text)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "";
}

/**
 * The most recently used tool names, newest-first and de-duplicated, capped at
 * `limit`. Tool parts are typed `tool-<Name>` (e.g. `tool-Read`); this strips
 * the prefix. Used as a secondary recall signal — what the model was just doing
 * hints at which memories are relevant to the current task.
 */
export function recentToolNames(messages: Message[], limit = 8): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  outer: for (let i = messages.length - 1; i >= 0; i--) {
    const parts = messages[i]?.parts ?? [];
    for (let j = parts.length - 1; j >= 0; j--) {
      const type = (parts[j] as { type?: string }).type;
      if (typeof type !== "string" || !type.startsWith("tool-")) continue;
      const name = type.slice("tool-".length);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
      if (names.length >= limit) break outer;
    }
  }
  return names;
}
