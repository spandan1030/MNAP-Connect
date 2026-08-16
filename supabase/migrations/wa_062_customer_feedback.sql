-- wa_062_customer_feedback.sql
-- ============================================================================
--  BIRTHDAY / ANNIVERSARY + REVIEW FEEDBACK captured on the invoice ("Bill
--  Summary") page in the customer app, fed back here so they're usable in
--  Connect (birthday/anniversary campaigns, and a log of what unhappy buyers
--  flagged).
--
--  The customer app resolves nothing about identity itself: it posts the invoice
--  TOKEN, and the ingest route (/api/invoices/feedback) maps token -> phone via
--  wa_invoices, then writes here. So the browser never handles the phone.
--
--    · contacts.birthday_month / anniversary_month  (1–12) — person attributes on
--      the spine, so a "birthday this month" audience is a normal rule later.
--    · wa_customer_feedback — one row per low-star submission (rating + reason).
--
--  Idempotent: safe to re-run.
-- ============================================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS birthday_month    SMALLINT CHECK (birthday_month    BETWEEN 1 AND 12),
  ADD COLUMN IF NOT EXISTS anniversary_month SMALLINT CHECK (anniversary_month BETWEEN 1 AND 12);

CREATE INDEX IF NOT EXISTS contacts_birthday_month_idx    ON contacts (birthday_month)    WHERE birthday_month    IS NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_anniversary_month_idx ON contacts (anniversary_month) WHERE anniversary_month IS NOT NULL;

CREATE TABLE IF NOT EXISTS wa_customer_feedback (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       TEXT        NOT NULL,
  bill_no     TEXT,                         -- the bill the review came from (context)
  rating      SMALLINT    CHECK (rating BETWEEN 1 AND 5),
  reason      TEXT,                         -- 'Delivery Issue' | 'Price Issue' | free text
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wa_customer_feedback_phone_idx   ON wa_customer_feedback (phone);
CREATE INDEX IF NOT EXISTS wa_customer_feedback_created_idx ON wa_customer_feedback (created_at DESC);

ALTER TABLE wa_customer_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read feedback"
  ON wa_customer_feedback FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated manage feedback"
  ON wa_customer_feedback FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
