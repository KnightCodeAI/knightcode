-- The desktop app's sign-in: the browser, signed in, hands the app a one-time code for its state; the app trades it for
-- a desktop session. Codes live five minutes and are used once.
CREATE TABLE desktop_codes (
  code_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  state TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
