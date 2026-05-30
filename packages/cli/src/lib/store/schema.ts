import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// One row per conversation, scoped to a working directory.
export const sessionTable = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    directory: text("directory").notNull(),
    title: text("title").notNull(),
    model: text("model"),
    reasoningEffort: text("reasoning_effort").notNull().default("medium"),
    timeCreated: integer("time_created").notNull(), // epoch ms
    timeUpdated: integer("time_updated").notNull(),
  },
  (t) => [index("session_directory_idx").on(t.directory)],
);

// One row per turn; parts kept as a typed JSON column (matches AI SDK UIMessage).
export const messageTable = sqliteTable(
  "message",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessionTable.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    parts: text("parts", { mode: "json" }).notNull().$type<unknown[]>(),
    metadata: text("metadata", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
    status: text("status").notNull().default("complete"), // "streaming" | "complete"
    ord: integer("ord").notNull(),
    timeStarted: integer("time_started"),
    timeCompleted: integer("time_completed"),
    durationMs: integer("duration_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
  },
  (t) => [uniqueIndex("message_session_ord_uq").on(t.sessionId, t.ord)],
);

export type SessionRow = typeof sessionTable.$inferSelect;
export type NewSessionRow = typeof sessionTable.$inferInsert;
export type MessageRow = typeof messageTable.$inferSelect;
export type NewMessageRow = typeof messageTable.$inferInsert;
