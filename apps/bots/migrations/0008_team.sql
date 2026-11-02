-- The account's bots (spec sections 5 and 11): for listing, the sidebar order and management. A bot manages only the
-- bots it created or that the user assigned to it (managed_by).
CREATE TABLE bots (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  managed_by TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX bots_account ON bots (account_id);

-- Group chats: 2 to 10 bots and the user, one shared conversation, turns fenced by id.
CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  lead_bot TEXT NOT NULL,
  members TEXT NOT NULL,
  rules TEXT NOT NULL DEFAULT '',
  turn_budget INTEGER NOT NULL DEFAULT 20,
  created_at INTEGER NOT NULL
);
CREATE TABLE group_messages (
  group_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  author TEXT NOT NULL,
  text TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (group_id, seq)
);
CREATE TABLE group_turns (
  turn_id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  member TEXT NOT NULL,
  state TEXT NOT NULL,
  issued_at INTEGER NOT NULL
);
CREATE INDEX group_turns_member ON group_turns (group_id, member);
