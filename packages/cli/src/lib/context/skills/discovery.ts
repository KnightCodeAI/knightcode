import { debugLog } from "../../debug";
import { sideQuery } from "../../inference/side-query";
import { extractJsonArray } from "../../memory/json";
import type { ContextProvider } from "../../engine/context-providers";
import { latestUserText } from "../../engine/context-providers";
import { listSkills } from "../skills";

const MAX_DISCOVERED = 5;
// Reasoning side models spend output tokens before the JSON answer; give the
// short array headroom so it isn't truncated to nothing (mirrors recall.ts).
const DISCOVERY_MAX_TOKENS = 1024;

/** Injected for tests; defaults to the real side query. */
export type DiscoverySideQueryFn = typeof sideQuery;

const DISCOVER_SYSTEM = `You help a coding assistant notice when an installed skill is relevant to the user's request. You are given the user's message and a list of available skills (name + description).

Return ONLY a JSON array of skill names (strings) that are CLEARLY relevant to this specific request — at most 5. Be selective:
- Include a skill only if it would genuinely help with this request.
- If none clearly apply, return an empty array [].
- Use the exact skill names from the list.
- Output nothing but the JSON array.`;

/**
 * Pick the installed skills most relevant to a query via a cheap side query.
 * Returns at most 5 names, each guaranteed to be an eligible candidate. Never
 * throws; returns [] when there are no eligible skills or the side model
 * declines/fails.
 */
export async function discoverRelevantSkills(opts: {
  query: string;
  cwd: string;
  mainModelId: string;
  /** Skill names already nudged this session — excluded from the candidate set. */
  alreadySent?: ReadonlySet<string>;
  getApiKey?: () => string | undefined;
  signal?: AbortSignal;
  sideQueryImpl?: DiscoverySideQueryFn;
}): Promise<string[]> {
  if (!opts.query.trim()) return [];
  const candidates = listSkills(opts.cwd).filter(
    (s) => !s.disableModelInvocation && !(opts.alreadySent?.has(s.name) ?? false),
  );
  if (candidates.length === 0) return [];

  const manifest = candidates
    .map((s) => `- ${s.name}: ${s.description}`)
    .join("\n");
  const run = opts.sideQueryImpl ?? sideQuery;
  const raw = await run({
    system: DISCOVER_SYSTEM,
    prompt: `User request:\n${opts.query}\n\nAvailable skills:\n${manifest}`,
    mainModelId: opts.mainModelId,
    getApiKey: opts.getApiKey,
    signal: opts.signal,
    maxOutputTokens: DISCOVERY_MAX_TOKENS,
  });

  const valid = new Set(candidates.map((s) => s.name));
  const names = extractJsonArray(raw).filter(
    (n): n is string => typeof n === "string" && valid.has(n),
  );
  const selected: string[] = [];
  for (const name of names) {
    if (!selected.includes(name)) selected.push(name);
    if (selected.length >= MAX_DISCOVERED) break;
  }
  debugLog(
    "skills.discovery",
    `candidates=${candidates.length} rawLen=${raw.length} selected=${selected.length}`,
    selected,
  );
  return selected;
}

/** Render selected skill names into a single nudge reminder. */
export function renderDiscoveryBlock(names: string[]): string[] {
  if (names.length === 0) return [];
  return [
    `These installed skills look relevant to the current request — load one with the Skill tool if it fits: ${names.join(", ")}.`,
  ];
}

/**
 * A turn-start ContextProvider that nudges the model toward installed skills
 * relevant to the latest user message.
 *
 * Two pieces of state, both session-scoped (the provider is rebuilt when the
 * model changes, like recall):
 * - `sent`: skill names already nudged — each skill is announced at most once
 *   (mirrors claude-code's sent-set), so the channel stays low-noise.
 * - per-query cache: identical consecutive queries (retries/regenerations)
 *   reuse the last selection instead of paying for the selector again.
 */
export function createSkillDiscoveryProvider(opts: {
  mainModelId: string;
  getApiKey?: () => string | undefined;
  sideQueryImpl?: DiscoverySideQueryFn;
}): ContextProvider {
  const sent = new Set<string>();
  let cacheKey: string | null = null;
  let cacheValue: string[] = [];
  return {
    phase: "turn_start",
    run: async ({ messages, cwd, signal }) => {
      const query = latestUserText(messages);
      if (!query) return [];
      const key = JSON.stringify([cwd, query]);
      if (key === cacheKey) return cacheValue;

      const names = await discoverRelevantSkills({
        query,
        cwd,
        mainModelId: opts.mainModelId,
        alreadySent: sent,
        getApiKey: opts.getApiKey,
        signal,
        sideQueryImpl: opts.sideQueryImpl,
      });
      const fresh = names.filter((n) => !sent.has(n));
      fresh.forEach((n) => sent.add(n));
      const block = renderDiscoveryBlock(fresh);
      cacheKey = key;
      cacheValue = block;
      return block;
    },
  };
}
