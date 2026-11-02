-- Deleted accounts (spec section 15): recovery jobs check this before writing anything for an account again.
CREATE TABLE deleted_accounts (
  account_id TEXT PRIMARY KEY,
  deleted_at INTEGER NOT NULL
);
