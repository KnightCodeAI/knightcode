CREATE TABLE bug_reports (
  id             TEXT PRIMARY KEY,
  created_at     INTEGER NOT NULL,
  prefix         TEXT NOT NULL,
  client_id      TEXT,
  version        TEXT,
  platform       TEXT,
  arch           TEXT,
  runtime        TEXT,
  description    TEXT,
  has_session    INTEGER NOT NULL DEFAULT 0,
  has_summary    INTEGER NOT NULL DEFAULT 0,
  crash_count    INTEGER NOT NULL DEFAULT 0,
  size_bytes     INTEGER NOT NULL
);

CREATE INDEX bug_reports_created ON bug_reports (created_at DESC);
