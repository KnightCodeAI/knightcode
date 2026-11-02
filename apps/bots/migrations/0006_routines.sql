-- Routing of outside events to routines (spec section 12): each trigger's routing key (a repository, a Slack team and
-- channel, a bot's email address, a webhook id) and the routine and bot it fires. Webhook secrets are stored hashed.
CREATE TABLE routine_triggers (
  routine_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  route_key TEXT NOT NULL,
  secret_hash TEXT,
  PRIMARY KEY (routine_id, kind, route_key)
);
CREATE INDEX routine_triggers_route ON routine_triggers (kind, route_key);

-- Each bot's own email address (spec section 10), unique across the site.
CREATE TABLE bot_addresses (
  address TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  account_id TEXT NOT NULL
);

-- Which accounts a Slack workspace's events belong to, and the owner's own Slack user (for "only my reactions");
-- filled when the Slack app is installed (Task 3.5).
CREATE TABLE slack_teams (
  team_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  owner_user_id TEXT,
  PRIMARY KEY (team_id, account_id)
);

-- Composio connected accounts, so an event's connected account finds its owner and app; filled on connect.
CREATE TABLE composio_accounts (
  connected_account_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  app_id TEXT NOT NULL
);
