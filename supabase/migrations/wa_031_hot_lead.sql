-- wa_031: hot-lead star (call-sourced signal)
-- Staff tap a star on the call card to flag a meaningful / high-intent lead
-- (long, detailed conversation) — independent of the will-come/won't-come intent.
-- It is a per-customer flag (like is_do_not_call), exported in call_feedback.csv
-- and picked up by the customer-signals pipeline as a call marker + lookalike seed.

ALTER TABLE wa_b_customers ADD COLUMN IF NOT EXISTS is_hot_lead BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE wa_b_customers ADD COLUMN IF NOT EXISTS hot_lead_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS wa_b_customers_is_hot_lead_idx ON wa_b_customers (is_hot_lead);
