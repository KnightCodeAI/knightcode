import { randomUUID } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import type { Store } from "./client";
import { messageTable, sessionTable, type SessionRow } from "./schema";

export interface CreateSessionInput {
  id?: string;
  directory: string;
  title: string;
  model?: string | null;
  reasoningEffort?: string;
}

export function createSession(db: Store, input: CreateSessionInput): SessionRow {
  const now = Date.now();
  const row: SessionRow = {
    id: input.id ?? randomUUID(),
    directory: input.directory,
    title: input.title,
    model: input.model ?? null,
    reasoningEffort: input.reasoningEffort ?? "medium",
    timeCreated: now,
    timeUpdated: now,
  };
  db.insert(sessionTable).values(row).run();
  return row;
}

export function listSessions(db: Store, directory: string): SessionRow[] {
  return db
    .select()
    .from(sessionTable)
    .where(eq(sessionTable.directory, directory))
    .orderBy(desc(sessionTable.timeUpdated))
    .all();
}

export function getSession(db: Store, id: string): SessionRow | null {
  return (
    db.select().from(sessionTable).where(eq(sessionTable.id, id)).get() ?? null
  );
}

export function renameSession(db: Store, id: string, title: string): void {
  db.update(sessionTable)
    .set({ title, timeUpdated: Date.now() })
    .where(eq(sessionTable.id, id))
    .run();
}

export function touchSession(db: Store, id: string): void {
  db.update(sessionTable)
    .set({ timeUpdated: Date.now() })
    .where(eq(sessionTable.id, id))
    .run();
}

export function deleteSession(db: Store, id: string): void {
  db.delete(sessionTable).where(eq(sessionTable.id, id)).run();
}

export function setSessionReasoningEffort(
  db: Store,
  id: string,
  reasoningEffort: string,
): void {
  db.update(sessionTable)
    .set({ reasoningEffort, timeUpdated: Date.now() })
    .where(eq(sessionTable.id, id))
    .run();
}

export interface DirectorySessionStat {
  sessionId: string;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  messageCount: number;
}

/**
 * Per-session token/message aggregates for every session in `directory`.
 * Cost is derived by the caller from each session's `model` pricing
 * (an approximation: a session's tokens are priced at its last model).
 */
export function directorySessionStats(
  db: Store,
  directory: string,
): DirectorySessionStat[] {
  return db
    .select({
      sessionId: sessionTable.id,
      model: sessionTable.model,
      inputTokens: sql<number>`coalesce(sum(${messageTable.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${messageTable.outputTokens}), 0)`,
      messageCount: sql<number>`count(${messageTable.id})`,
    })
    .from(sessionTable)
    .leftJoin(messageTable, eq(messageTable.sessionId, sessionTable.id))
    .where(eq(sessionTable.directory, directory))
    .groupBy(sessionTable.id)
    .all();
}
