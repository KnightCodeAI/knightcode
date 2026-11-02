-- Email codes (spec section 4): when the last code was sent, and how many in the current hour, so codes cannot be
-- sent in a flood and resending does not buy more guesses.
ALTER TABLE email_codes ADD COLUMN sent_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_codes ADD COLUMN sends INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_codes ADD COLUMN window_start INTEGER NOT NULL DEFAULT 0;
