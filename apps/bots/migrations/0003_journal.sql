-- The append-only billing journal (spec section 16). Balances are projections of it; an entry's key is unique per
-- account, so a retried copy or a replayed webhook never adds an entry twice.
CREATE TABLE billing_journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  entry_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  cents INTEGER NOT NULL,
  ref TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (account_id, entry_key)
);
CREATE INDEX billing_journal_account ON billing_journal (account_id, created_at);
