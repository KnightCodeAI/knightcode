-- Bug reports are read by an allowlist of email addresses rather than GitHub logins, so the
-- verified primary address is stored at sign-in. Nullable on purpose: rows created before
-- this migration have none until their next sign-in, and a null never matches the allowlist.
ALTER TABLE accounts ADD COLUMN email TEXT;
