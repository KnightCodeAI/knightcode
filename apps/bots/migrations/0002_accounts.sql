-- Accounts and sign-in (spec sections 4 and 21): who an account is, how it signs in, its handle and sessions, and the
-- short-lived records a sign-in needs. One workspace per account in the MVP.
ALTER TABLE accounts ADD COLUMN email TEXT;
ALTER TABLE accounts ADD COLUMN name TEXT;
ALTER TABLE accounts ADD COLUMN workspace_id TEXT;

-- One row per way into an account: a GitHub or Google user, an email address, a passkey.
CREATE TABLE identities (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  account_id TEXT NOT NULL,
  email TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX identities_account ON identities (account_id);

-- A handle is chosen once and never reassigned.
CREATE TABLE handles (
  handle TEXT PRIMARY KEY,
  account_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

-- A session is stored as the SHA-256 of its token, so a leaked table signs no one in.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  client TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX sessions_account ON sessions (account_id);

CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  next TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- The code itself is never stored, only its keyed hash.
CREATE TABLE email_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL,
  transports TEXT,
  name TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX passkeys_account ON passkeys (account_id);

CREATE TABLE passkey_challenges (
  challenge TEXT PRIMARY KEY,
  account_id TEXT,
  expires_at INTEGER NOT NULL
);
