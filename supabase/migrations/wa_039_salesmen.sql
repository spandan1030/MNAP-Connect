-- wa_039_salesmen.sql
-- Salesmen — a lightweight roster (name + short alias) so a single shared login
-- can attribute each call and walk-in to the actual person. Distinct from app
-- login accounts (wa_b_call_logs.called_by stays the device user).
--   • wa_b_call_logs.salesman_id  — who made this call (null on past calls → "-")
--   • wa_b_customers.walkin_salesman_id / walkin_at — who enrolled this walk-in
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS salesmen (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  alias      TEXT        NOT NULL,          -- short code shown in logs
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE wa_b_call_logs  ADD COLUMN IF NOT EXISTS salesman_id        UUID REFERENCES salesmen(id) ON DELETE SET NULL;
ALTER TABLE wa_b_customers  ADD COLUMN IF NOT EXISTS walkin_salesman_id UUID REFERENCES salesmen(id) ON DELETE SET NULL;
ALTER TABLE wa_b_customers  ADD COLUMN IF NOT EXISTS walkin_at          TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS wa_b_call_logs_salesman_idx ON wa_b_call_logs(salesman_id) WHERE salesman_id IS NOT NULL;

ALTER TABLE salesmen ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read salesmen" ON salesmen;
CREATE POLICY "Authenticated read salesmen" ON salesmen FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated manage salesmen" ON salesmen;
CREATE POLICY "Authenticated manage salesmen" ON salesmen
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
