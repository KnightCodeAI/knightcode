import { debugLog } from "../debug";
import { query } from "../engine/query";
import type { Message } from "../engine/messages";
import { resolveSideQueryModelId } from "../inference/side-query";
import { getExtractCursor, setExtractCursor } from "./extract-cursor";
import { createBackgroundToolHost } from "./background-host";
import { buildExtractionPrompt } from "./prompts";
import { scanMemoryFiles, type MemoryHeader } from "./scan";

// Skip extraction on turns with no substantive user input (greetings, "ok").
const MIN_USER_TEXT_FOR_EXTRACTION = 15;
// The forked extraction agent only investigates + persists memories.
const EXTRACTION_TOOLS = ["Read", "Grep", "Glob", "Memory"];
// Well-behaved extractions finish in 2-4 rounds (review → save). Cap to stop
// verification rabbit-holes.
const EXTRACTION_MAX_ROUNDS = 6;

export type ExtractionRunner = (params: {
  messages: Message[];
  cwd: string;
  mainModelId: string;
  getApiKey?: () => string | undefined;
  signal?: AbortSignal;
}) => Promise<number>;

/** True when the turn has enough user signal to be worth extracting. */
export function hasExtractableSignal(messages: Message[]): boolean {
  for (const m of messages) {
    if (m.role !== "user") continue;
    const text = m.parts
      .filter(
        (p): p is { type: "text"; text: string } =>
          (p as { type?: string }).type === "text" &&
          typeof (p as { text?: unknown }).text === "string",
      )
      .map((p) => p.text)
      .join(" ")
      .trim();
    if (text.length >= MIN_USER_TEXT_FOR_EXTRACTION) return true;
  }
  return false;
}

/**
 * True when the just-completed turn already wrote to memory (the main agent
 * called Memory update/delete). The forked extraction would be redundant, so
 * we skip it (mutual exclusion with the main agent).
 */
export function hasRecentMemoryWrite(messages: Message[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== "assistant") continue;
    for (const part of m.parts) {
      const p = part as { type?: string; input?: { action?: unknown } };
      if (
        p?.type === "tool-Memory" &&
        (p.input?.action === "update" || p.input?.action === "delete")
      ) {
        return true;
      }
    }
    return false; // only inspect the most recent assistant turn
  }
  return false;
}

/** ~Number of model-visible messages in the last turn (the "~N messages" hint). */
function lastTurnMessageCount(messages: Message[]): number {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      lastUser = i;
      break;
    }
  }
  if (lastUser === -1) return messages.length;
  return messages.length - lastUser;
}

/** Existing-memory listing for the extraction prompt. */
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

/**
 * The default forked extraction agent: runs the real engine query loop in AUTO
 * mode with a restricted toolset (Read/Grep/Glob + Memory), letting the model
 * investigate and persist memories itself via the Memory tool. Returns the
 * number of memories created/updated/deleted. Best-effort - never throws.
 */
async function defaultExtractionRunner(params: {
  messages: Message[];
  cwd: string;
  mainModelId: string;
  getApiKey?: () => string | undefined;
  signal?: AbortSignal;
}): Promise<number> {
  let written = 0;
  const host = createBackgroundToolHost({
    cwd: params.cwd,
    sessionId: "memory-extract",
    onToolResult: (toolName, output) => {
      if (toolName !== "Memory") return;
      const o = output as { success?: boolean; action?: string; changed?: boolean };
      if (!o?.success) return;
      if (o.action === "delete") written++;
      else if (o.action === "update" && o.changed !== false) written++;
    },
  });

  const gen = query({
    cwd: params.cwd,
    messages: params.messages,
    mode: "AUTO",
    modelId: resolveSideQueryModelId(params.mainModelId),
    reasoningEffort: "low",
    getApiKey: params.getApiKey,
    host,
    allowedToolNames: EXTRACTION_TOOLS,
    maxRounds: EXTRACTION_MAX_ROUNDS,
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
  return written;
}

/**
 * Run memory extraction over a completed turn. Builds the extraction prompt,
 * appends it to the conversation, and runs a forked agent that persists durable
 * memories via the Memory tool. Skips trivial turns and turns where the main
 * agent already wrote memory. Never throws. Returns the count written.
 */
export async function extractMemories(opts: {
  messages: Message[];
  cwd: string;
  mainModelId: string;
  /** When set, frames "new messages" relative to this session's cursor and
   *  advances the cursor once a run completes (reconsiders gate-skipped turns). */
  sessionId?: string;
  getApiKey?: () => string | undefined;
  signal?: AbortSignal;
  /** Injected for tests; defaults to the real forked agent. */
  runner?: ExtractionRunner;
}): Promise<number> {
  try {
    if (!hasExtractableSignal(opts.messages)) {
      debugLog("memory.extract", "skipped - no substantive user signal");
      return 0;
    }
    if (hasRecentMemoryWrite(opts.messages)) {
      debugLog("memory.extract", "skipped - turn already wrote to memory");
      return 0;
    }

    // Count what's new since this session last had a real extraction run, so a
    // fact mentioned during a previously gate-skipped turn is still in scope.
    // Falls back to "the last turn" when there's no cursor (or a stale one, e.g.
    // after compaction shrank the transcript below the cursor).
    const total = opts.messages.length;
    const cursor = opts.sessionId
      ? getExtractCursor(opts.sessionId)
      : undefined;
    const newMessageCount =
      cursor !== undefined && cursor <= total
        ? Math.max(1, total - cursor)
        : lastTurnMessageCount(opts.messages);
    const manifest = formatManifest(scanMemoryFiles(opts.cwd));
    const prompt = buildExtractionPrompt(newMessageCount, manifest);
    const extractionMessage: Message = {
      id: `memory-extract-${crypto.randomUUID()}`,
      role: "user",
      parts: [{ type: "text", text: prompt }],
    } as Message;

    const run = opts.runner ?? defaultExtractionRunner;
    const written = await run({
      messages: [...opts.messages, extractionMessage],
      cwd: opts.cwd,
      mainModelId: opts.mainModelId,
      getApiKey: opts.getApiKey,
      signal: opts.signal,
    });
    // The run reviewed everything up to here; advance the cursor so the next
    // extraction only reconsiders messages that arrive after this point.
    if (opts.sessionId) setExtractCursor(opts.sessionId, total);
    debugLog("memory.extract", `written=${written}`);
    return written;
  } catch {
    return 0;
  }
}
