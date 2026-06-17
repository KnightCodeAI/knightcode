import { readFileSync } from "fs";
import { debugLog } from "../debug";
import { sideQuery } from "../inference/side-query";
import type { ContextProvider } from "../engine/context-providers";
import { latestUserText, recentToolNames } from "../engine/context-providers";
import { extractJsonArray } from "./json";
import { scanMemoryFiles, stripFrontmatter, type MemoryHeader } from "./scan";

const MAX_RECALLED = 5;
// Reasoning side models spend output tokens on reasoning before the answer, so
// give the short JSON answer ample headroom or it gets truncated to nothing.
const RECALL_MAX_TOKENS = 2048;

/** Injected for tests; defaults to the real side query. */
export type SideQueryFn = typeof sideQuery;

const SELECT_SYSTEM = `You are selecting memories that will help a coding assistant answer a user's request. You are given the user's query and a list of available memory files (filename + description).

You may also be given the tools the assistant used most recently, as a hint about what it is currently working on.

Return ONLY a JSON array of filenames (strings) for the memories that will CLEARLY be useful — at most 5. Be selective:
- Include a memory only if you are confident it helps with this specific query.
- If none clearly help, return an empty array [].
- Output nothing but the JSON array.`;

/**
 * Pick the memory files most relevant to a query via a cheap side query.
 * Returns at most 5 headers; empty when there are no memories or the side model
 * declines/fails (it never throws).
 */
export async function findRelevantMemories(opts: {
  query: string;
  cwd: string;
  mainModelId: string;
  recentTools?: string[];
  getApiKey?: () => string | undefined;
  signal?: AbortSignal;
  sideQueryImpl?: SideQueryFn;
}): Promise<MemoryHeader[]> {
  if (!opts.query.trim()) return [];
  const memories = scanMemoryFiles(opts.cwd);
  if (memories.length === 0) return [];

  const manifest = memories
    .map((m) => `- ${m.filename}: ${m.description}`)
    .join("\n");
  const toolsHint =
    opts.recentTools && opts.recentTools.length > 0
      ? `\n\nRecent tools used: ${opts.recentTools.join(", ")}`
      : "";
  const run = opts.sideQueryImpl ?? sideQuery;
  const raw = await run({
    system: SELECT_SYSTEM,
    prompt: `User query:\n${opts.query}${toolsHint}\n\nAvailable memories:\n${manifest}`,
    mainModelId: opts.mainModelId,
    getApiKey: opts.getApiKey,
    signal: opts.signal,
    maxOutputTokens: RECALL_MAX_TOKENS,
  });

  const names = extractJsonArray(raw).filter(
    (n): n is string => typeof n === "string",
  );
  const byName = new Map(memories.map((m) => [m.filename, m]));
  const selected: MemoryHeader[] = [];
  for (const name of names) {
    const hit = byName.get(name);
    if (hit && !selected.includes(hit)) selected.push(hit);
    if (selected.length >= MAX_RECALLED) break;
  }
  debugLog(
    "memory.recall",
    `candidates=${memories.length} rawLen=${raw.length} selected=${selected.length}`,
    selected.map((m) => m.filename),
  );
  return selected;
}

/** Render selected memories into a single background-context reminder block. */
export function renderRecallBlock(selected: MemoryHeader[]): string[] {
  const blocks: string[] = [];
  for (const m of selected) {
    try {
      const body = stripFrontmatter(readFileSync(m.filePath, "utf-8")).trim();
      if (body) blocks.push(`### ${m.name}\n${body}`);
    } catch {
      // skip unreadable file
    }
  }
  if (blocks.length === 0) return [];
  return [
    `Relevant memories recalled for this request (background context — these reflect what was true when written; verify any file/function/flag names before relying on them):\n\n${blocks.join(
      "\n\n",
    )}`,
  ];
}

/**
 * A turn-start ContextProvider that recalls relevant memories for the latest
 * user message and injects their bodies.
 *
 * Note on dedup: reminders are request-view only (never persisted), so a memory
 * surfaced last turn is NOT in this turn's transcript — re-injecting relevant
 * memories every turn is *correct*. What we dedup is the redundant side-query
 * work: identical consecutive queries (retries/regenerations) reuse the cached
 * selection instead of paying for the selector again.
 */
export function createMemoryRecallProvider(opts: {
  mainModelId: string;
  getApiKey?: () => string | undefined;
  sideQueryImpl?: SideQueryFn;
}): ContextProvider {
  let cacheKey: string | null = null;
  let cacheValue: string[] = [];
  return {
    phase: "turn_start",
    run: async ({ messages, cwd, signal }) => {
      const query = latestUserText(messages);
      if (!query) return [];
      const recentTools = recentToolNames(messages);
      // Key on recent tools too: identical query text with different recent-tool
      // context is a different selection signal, so it must not reuse the cache
      // (retries/regenerations keep the same transcript, so they still hit it).
      // JSON-encode so no delimiter can collide across cwd/query/tool boundaries.
      const key = JSON.stringify([cwd, query, recentTools]);
      if (key === cacheKey) return cacheValue;

      const selected = await findRelevantMemories({
        query,
        cwd,
        mainModelId: opts.mainModelId,
        recentTools,
        getApiKey: opts.getApiKey,
        signal,
        sideQueryImpl: opts.sideQueryImpl,
      });
      const block = renderRecallBlock(selected);
      cacheKey = key;
      cacheValue = block;
      return block;
    },
  };
}
