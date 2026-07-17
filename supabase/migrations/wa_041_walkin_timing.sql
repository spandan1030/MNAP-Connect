-- wa_041_walkin_timing.sql
-- Structured walk-in "planning to buy" timing (was only free text in the note).
-- Customer-stated on the walk-in form as a button: within_7d | within_1m | 1_3m.
-- Powers the "buying-soon walk-in" audience (B4). Idempotent.

ALTER TABLE wa_b_customers ADD COLUMN IF NOT EXISTS walkin_timing TEXT;   -- within_7d | within_1m | 1_3m
CREATE INDEX IF NOT EXISTS wa_b_customers_walkin_timing_idx ON wa_b_customers(walkin_timing) WHERE walkin_timing IS NOT NULL;
