`-- Per-session uniqueness on ord prevents silent collisions from explicit-value
-- inserts (compaction, replaceSessionMessages) racing with autoincrement defaults.
CREATE UNIQUE INDEX "Message_sessionId_ord_key" ON "Message"("sessionId", "ord");
