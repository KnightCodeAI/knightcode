import { debugLog } from "../debug";
import { query } from "../engine/query";
import { getSettingValue } from "../settings";
import { resolveSideQueryModelId } from "../inference/side-query";
import { listSessions } from "../store/sessions";
import { getStore } from "../store/client";
import { createBackgroundToolHost } from "./background-host";
import {
  readLastConsolidatedAt,
  rollbackConsolidationLock,
  tryAcquireConsolidationLock,
} from "./consolidation-lock";
import { isMemoryEnabled } from "./config";
import { buildConsolidationPrompt } from "./prompts";
import { scanMemoryFiles, type MemoryHeader } from "./scan";

// Conservative defaults: only consolidate once a day, after several sessions.
const DEFAULT_MIN_HOURS = 24;
const DEFAULT_MIN_SESSIONS = 5;
const CONSOLIDATION_TOOLS = ["Read", "Grep", "Glob", "Memory"];
const CONSOLIDATION_MAX_ROUNDS = 12;

function num(key: string, fallback: number): number {
  const v = getSettingValue(key);
  // Accept >= 0 so a threshold can be explicitly set to 0 to disable that gate.
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;
}

/**
 * Auto-consolidation is off unless explicitly enabled - it's a heavier
 * background pass (a forked agent reviewing the whole store) and only makes
 * sense once memory has accumulated across many sessions. Requires auto-memory.
 */
export function isAutoDreamEnabled(): boolean {
  return isMemoryEnabled() && getSettingValue("memory.autoDream") === true;
}

/** Existing-memory listing for the consolidation prompt. */
function formatManifest(memories: MemoryHeader[]): string {
  return memories
    .map((m) => {
      const tag = m.type ? `[${m.type}] ` : "";
      return m.description
        ? `- ${tag}${m.name}: ${m.description}`
        : `- ${tag}${m.name}`;
    })
    .join("\n");
}

export type ConsolidationRunner = (params: {
  cwd: string;
  mainModelId: string;
  getApiKey?: () => string | undefined;
  signal?: AbortSignal;
}) => Promise<number>;

/** The default forked consolidation agent (engine query, restricted toolset). */
async function defaultConsolidationRunner(params: {
  cwd: string;
  mainModelId: string;
  getApiKey?: () => string | undefined;
  signal?: AbortSignal;
}): Promise<number> {
  let changes = 0;
  const host = createBackgroundToolHost({
    cwd: params.cwd,
    sessionId: "memory-dream",
    onToolResult: (toolName, output) => {
      if (toolName !== "Memory") return;
      const o = output as { success?: boolean; action?: string; changed?: boolean };
      if (!o?.success) return;
      if (o.action === "delete") changes++;
      else if (o.action === "update" && o.changed !== false) changes++;
    },
  });

  const manifest = formatManifest(scanMemoryFiles(params.cwd));
  const prompt = buildConsolidationPrompt(manifest);

  const gen = query({
    cwd: params.cwd,
    messages: [
      {
        id: `memory-dream-${crypto.randomUUID()}`,
        role: "user",
        parts: [{ type: "text", text: prompt }],
      } as never,
    ],
    mode: "AUTO",
    modelId: resolveSideQueryModelId(params.mainModelId),
    reasoningEffort: "low",
    getApiKey: params.getApiKey,
    host,
    allowedToolNames: CONSOLIDATION_TOOLS,
    maxRounds: CONSOLIDATION_MAX_ROUNDS,
    abortSignal: params.signal,
  });
  try {
    while (true) {
      const r = await gen.next();
      if (r.done) break;
    }
  } catch {
    // best-effort background work
  }
  return changes;
}

/**
 * Run memory consolidation if the gates pass (cheapest first): enabled → time
 * (>= minHours since last) → session count (>= minSessions updated since last)
 * → lock (no other process consolidating).
 * Never throws. Returns the number of memories changed (0 if it didn't run).
 */
export async function maybeRunConsolidation(opts: {
  cwd: string;
  mainModelId: string;
  getApiKey?: () => string | undefined;
  signal?: AbortSignal;
  runner?: ConsolidationRunner;
}): Promise<number> {
  try {
    if (!isAutoDreamEnabled()) return 0;

    const minHours = num("memory.dreamMinHours", DEFAULT_MIN_HOURS);
    const minSessions = num("memory.dreamMinSessions", DEFAULT_MIN_SESSIONS);

    // --- Time gate (one stat) ---
    const lastAt = readLastConsolidatedAt(opts.cwd);
    const hoursSince = (Date.now() - lastAt) / 3_600_000;
    if (hoursSince < minHours) return 0;

    // --- Session gate: distinct sessions in this cwd touched since last run ---
    let sessionsSince = 0;
    try {
      sessionsSince = listSessions(getStore(), opts.cwd).filter(
        (s) => s.timeUpdated > lastAt,
      ).length;
    } catch {
      sessionsSince = 0;
    }
    if (sessionsSince < minSessions) {
      debugLog(
        "memory.dream",
        `skip - ${sessionsSince}/${minSessions} sessions since last consolidation`,
      );
      return 0;
    }

    // --- Lock ---
    const priorMtime = tryAcquireConsolidationLock(opts.cwd);
    if (priorMtime === null) {
      debugLog("memory.dream", "skip - another process holds the lock");
      return 0;
    }

    debugLog(
      "memory.dream",
      `firing - ${hoursSince.toFixed(1)}h since last, ${sessionsSince} sessions`,
    );
    try {
      const run = opts.runner ?? defaultConsolidationRunner;
      const changes = await run({
        cwd: opts.cwd,
        mainModelId: opts.mainModelId,
        getApiKey: opts.getApiKey,
        signal: opts.signal,
      });
      debugLog("memory.dream", `completed - ${changes} memories changed`);
      return changes;
    } catch {
      // On failure, rewind the lock so the time-gate opens again next time.
      rollbackConsolidationLock(opts.cwd, priorMtime);
      return 0;
    }
  } catch {
    return 0;
  }
}
