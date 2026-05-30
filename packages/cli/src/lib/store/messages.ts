import { asc, eq, sql } from "drizzle-orm";
import type { Store } from "./client";
import { messageTable, sessionTable, type MessageRow } from "./schema";

export interface AppendMessageInput {
  id: string;
  sessionId: string;
  role: string;
  parts: unknown[];
  metadata?: Record<string, unknown> | null;
  status?: string;
  timeStarted?: number | null;
  timeCompleted?: number | null;
  durationMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

export function appendMessage(db: Store, input: AppendMessageInput): MessageRow {
  // Allocate ord inside the INSERT via a subquery so concurrent writers can't
  // collide on UNIQUE(session_id, ord): SQLite serializes writers, so each
  // INSERT recomputes max(ord) under its own write lock.
  const inserted = db
    .insert(messageTable)
    .values({
      id: input.id,
      sessionId: input.sessionId,
      role: input.role,
      parts: input.parts,
      metadata: input.metadata ?? null,
      status: input.status ?? "complete",
      ord: sql`(select coalesce(max(${messageTable.ord}), 0) + 1 from ${messageTable} where ${messageTable.sessionId} = ${input.sessionId})`,
      timeStarted: input.timeStarted ?? null,
      timeCompleted: input.timeCompleted ?? null,
      durationMs: input.durationMs ?? null,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
    })
    .returning()
    .get();
  if (!inserted) throw new Error("appendMessage: insert returned no row");
  db.update(sessionTable)
    .set({ timeUpdated: Date.now() })
    .where(eq(sessionTable.id, input.sessionId))
    .run();
  return inserted;
}

export interface UpdateMessagePatch {
  parts?: unknown[];
  metadata?: Record<string, unknown> | null;
  status?: string;
  timeCompleted?: number | null;
  durationMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

export function updateMessage(
  db: Store,
  id: string,
  patch: UpdateMessagePatch,
): void {
  db.update(messageTable).set(patch).where(eq(messageTable.id, id)).run();
}

export function getMessages(db: Store, sessionId: string): MessageRow[] {
  return db
    .select()
    .from(messageTable)
    .where(eq(messageTable.sessionId, sessionId))
    .orderBy(asc(messageTable.ord))
    .all();
}

export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  messageCount: number;
}

export function sessionUsage(db: Store, sessionId: string): SessionUsage {
  const row = db
    .select({
      inputTokens: sql<number>`coalesce(sum(${messageTable.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${messageTable.outputTokens}), 0)`,
      messageCount: sql<number>`count(*)`,
    })
    .from(messageTable)
    .where(eq(messageTable.sessionId, sessionId))
    .get();
  return {
    inputTokens: row?.inputTokens ?? 0,
    outputTokens: row?.outputTokens ?? 0,
    messageCount: row?.messageCount ?? 0,
  };
}
