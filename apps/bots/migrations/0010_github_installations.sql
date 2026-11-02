-- Which account installed the GitHub App on which installation: a repository's events reach only the routines of
-- accounts holding the installation that delivered them.
CREATE TABLE github_installations (
  installation_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  PRIMARY KEY (installation_id, account_id)
);
