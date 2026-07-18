-- wa_043_audience_seed_key.sql
-- Make preset seeding idempotent & race-safe. A stable `seed_key` (the catalogue
-- key A1..AD1) with a UNIQUE index means re-clicking Seed — or two concurrent
-- requests — can never create duplicates (ON CONFLICT DO NOTHING).
-- Also clears the duplicate/partial seeded rows created by the earlier race, so
-- re-seeding starts clean. Only touches is_seeded rows (user-made audiences safe).
-- Idempotent.

ALTER TABLE wa_audiences ADD COLUMN IF NOT EXISTS seed_key TEXT;

-- Remove the earlier duplicated seeded audiences (their members cascade; any
-- linked campaigns keep their history via ON DELETE SET NULL).
DELETE FROM wa_audiences WHERE is_seeded = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS wa_audiences_seed_key_uidx ON wa_audiences(seed_key) WHERE seed_key IS NOT NULL;
