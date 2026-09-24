-- wa_070_followups.sql
-- ============================================================================
--  SCHEDULED FOLLOW-UPS — "remind me to contact this customer in X days".
--
--  Distinct from walk-in visits (past events) and cold-call tasks (admin
--  campaign-driven). A salesman schedules a personal follow-up from the chat or
--  the walk-in form: a due date, what the customer wanted (canonical interest
--  keys, same tap-tap vocabulary as walk-in), and a short note. The Follow-ups
--  module lists everything that's due.
--
--  Idempotent: safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS wa_followups (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        TEXT NOT NULL,                                  -- 10-digit join key
  customer_id  UUID REFERENCES wa_b_customers(id) ON DELETE SET NULL,
  salesman_id  UUID REFERENCES salesmen(id)       ON DELETE SET NULL,  -- who owns it
  created_by   UUID REFERENCES profiles(id),                  -- app user who scheduled
  due_on       DATE NOT NULL,                                  -- when to make contact
  interests    TEXT[],                                         -- canonical interest keys
  note         TEXT,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','done','cancelled')),
  done_at      TIMESTAMPTZ,
  done_by      UUID REFERENCES profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wa_followups_due_idx   ON wa_followups (status, due_on);
CREATE INDEX IF NOT EXISTS wa_followups_phone_idx ON wa_followups (phone);

ALTER TABLE wa_followups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read followups" ON wa_followups;
CREATE POLICY "Authenticated read followups" ON wa_followups
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated manage followups" ON wa_followups;
CREATE POLICY "Authenticated manage followups" ON wa_followups
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

GRANT SELECT ON wa_followups TO authenticated, service_role;
