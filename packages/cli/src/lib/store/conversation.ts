import { asc, eq } from "drizzle-orm";
import type { Store } from "./client";
import { messageTable, sessionTable } from "./schema";

export type StoredUIMessage = {
  id: string;
  role: string;
  parts: unknown[];
  metadata?: Record<string, unknown> | null;
};

export type EnsureSessionInput = {
  id: string;
  directory: string;
  title: string;
  model?: string | null;
  reasoningEffort?: string;
};

/** Insert a session row if one does not already exist (no-op otherwise). */
export function ensureSession(db: Store, input: EnsureSessionInput): void {
  const now = Date.now();
  db.insert(sessionTable)
    .values({
      id: input.id,
      directory: input.directory,
      title: input.title,
      model: input.model ?? null,
      reasoningEffort: input.reasoningEffort ?? "medium",
      timeCreated: now,
      timeUpdated: now,
    })
    .onConflictDoNothing()
    .run();
}

function readUsage(metadata: Record<string, unknown> | null | undefined): {
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
} {
  const usage = (metadata?.usage ?? null) as
    | { inputTokens?: number; outputTokens?: number }
    | null;
  const durationMs = metadata?.durationMs;
  return {
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    durationMs: typeof durationMs === "number" ? durationMs : null,
  };
}

/**
 * Replace the whole transcript for a session: delete existing rows, re-insert
 * in array order with ords 1..N. Used by the transport's onFinish and by
 * compact/clear/rewind. Runs in one synchronous bun:sqlite transaction.
 */
export function replaceSessionMessages(
  db: Store,
  sessionId: string,
  messages: ReadonlyArray<StoredUIMessage>,
): void {
  db.transaction((tx) => {
    tx.delete(messageTable).where(eq(messageTable.sessionId, sessionId)).run();
    let ord = 0;
    for (const m of messages) {
      ord += 1;
      const metadata = m.metadata ?? null;
      const status =
        (metadata?.__status as string | undefined) === "error"
          ? "error"
          : "complete";
      const usage = readUsage(metadata);
      tx.insert(messageTable)
        .values({
          id: m.id,
          sessionId,
          role: m.role,
          parts: m.parts,
          metadata,
          status,
          ord,
          timeStarted: null,
          timeCompleted: Date.now(),
          durationMs: usage.durationMs,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        })
        .run();
    }
    tx.update(sessionTable)
      .set({ timeUpdated: Date.now() })
      .where(eq(sessionTable.id, sessionId))
      .run();
  });
}

/** Load a session's transcript as UIMessage-shaped objects, dropping error rows. */
export function loadConversation(
  db: Store,
  sessionId: string,
): StoredUIMessage[] {
  return db
    .select()
    .from(messageTable)
    .where(eq(messageTable.sessionId, sessionId))
    .orderBy(asc(messageTable.ord))
    .all()
    .filter(
      (row) =>
        row.status !== "error" &&
        !(row.role === "assistant" && Array.isArray(row.parts) && row.parts.length === 0),
    )
    .map((row) => ({
      id: row.id,
      role: row.role,
      parts: (row.parts ?? []) as unknown[],
      metadata: (row.metadata ?? undefined) as
        | Record<string, unknown>
        | undefined,
    }));
}
