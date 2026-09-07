CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  login TEXT NOT NULL,
  avatar_url TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (provider, provider_user_id)
);

CREATE TABLE cli_tokens (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id),
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);

CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id),
  session_name TEXT,
  cwd TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  status TEXT NOT NULL
);

CREATE INDEX rooms_by_account ON rooms (account_id, last_seen_at DESC);
