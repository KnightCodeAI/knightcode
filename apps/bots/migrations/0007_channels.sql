-- Channels (spec section 10). A linked chat or DM routes to one bot of one account.
CREATE TABLE channel_links (
  channel TEXT NOT NULL,
  external_chat TEXT NOT NULL,
  account_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'direct',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (channel, external_chat)
);

-- Link codes: shown in Settings, sent to the Telegram bot within ten minutes. Stored hashed.
CREATE TABLE link_codes (
  code_hash TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  account_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Outbound mail per account: who has written to the account's bots (replies to them are not capped), each send by
-- day, and bounces, so mail to people who never wrote first is capped and bad mail pauses sending.
CREATE TABLE email_correspondents (
  account_id TEXT NOT NULL,
  address TEXT NOT NULL,
  PRIMARY KEY (account_id, address)
);
CREATE TABLE email_sends (
  account_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  day TEXT NOT NULL,
  is_new INTEGER NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX email_sends_account_day ON email_sends (account_id, day);
CREATE TABLE email_health (
  account_id TEXT PRIMARY KEY,
  bounces INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  paused_until INTEGER
);
