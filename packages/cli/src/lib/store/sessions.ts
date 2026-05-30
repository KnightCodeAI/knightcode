import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { Store } from "./client";
import { sessionTable, type SessionRow } from "./schema";

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
