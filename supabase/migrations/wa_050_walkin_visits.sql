-- wa_050_walkin_visits.sql
-- ============================================================================
--  WALK-IN VISIT LOG — stop overwriting history.
--
--  Until now a visit was three columns on the customer row (walkin_at,
--  walkin_timing, walkin_salesman_id), so every new visit ERASED the previous
--  one. A customer who came in March and again in July looked like a single
--  July visitor. That made whole questions unanswerable:
--    · how many times has this person visited?
--    · who visited between two dates? (only answerable for people who
--      haven't been back since)
--    · which salesman enrolled them the FIRST time?
--    · do repeat visitors convert better than one-timers?
--
--  One row per visit fixes all of them, and the customer columns stay as a
--  fast "latest visit" cache, kept true by trigger.
--
--  Idempotent: safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS wa_walkin_visits (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        TEXT NOT NULL,                 -- 10-digit, the universal join key
  customer_id  UUID REFERENCES wa_b_customers(id) ON DELETE SET NULL,
  visited_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  salesman_id  UUID REFERENCES salesmen(id) ON DELETE SET NULL,
  timing       TEXT,                          -- within_7d | within_1m | 1_3m
  note         TEXT,
  interests    TEXT[],                        -- what came up on THIS visit
  is_backfill  BOOLEAN NOT NULL DEFAULT FALSE,-- reconstructed, not observed
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wa_walkin_visits_phone_idx ON wa_walkin_visits (phone);
CREATE INDEX IF NOT EXISTS wa_walkin_visits_at_idx    ON wa_walkin_visits (visited_at);
CREATE INDEX IF NOT EXISTS wa_walkin_visits_cust_idx  ON wa_walkin_visits (customer_id);

COMMENT ON TABLE wa_walkin_visits IS
  'One row per store visit. The customer row keeps only the LATEST visit as a '
  'cache; this is the history. Rows with is_backfill = true were reconstructed '
  'from that cache when the log was introduced (wa_050) — before this date, only '
  'the most recent visit per person survives, so visit counts start at 1.';

ALTER TABLE wa_walkin_visits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read walkin visits" ON wa_walkin_visits;
CREATE POLICY "Authenticated read walkin visits" ON wa_walkin_visits
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated write walkin visits" ON wa_walkin_visits;
CREATE POLICY "Authenticated write walkin visits" ON wa_walkin_visits
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- ── Keep the customer row's "latest visit" cache honest ─────────────────────
-- Recomputed from the log, never incremented, so deleting or back-dating a
-- visit corrects the cache instead of leaving it stale.
CREATE OR REPLACE FUNCTION wa_sync_latest_walkin(cid UUID) RETURNS VOID AS $$
DECLARE
  latest RECORD;
BEGIN
  IF cid IS NULL THEN RETURN; END IF;
  SELECT visited_at, timing, salesman_id INTO latest
    FROM wa_walkin_visits WHERE customer_id = cid
   ORDER BY visited_at DESC LIMIT 1;

  UPDATE wa_b_customers c
     SET walkin_at          = latest.visited_at,
         walkin_timing      = latest.timing,
         walkin_salesman_id = latest.salesman_id
   WHERE c.id = cid
     AND (c.walkin_at IS DISTINCT FROM latest.visited_at
       OR c.walkin_timing IS DISTINCT FROM latest.timing
       OR c.walkin_salesman_id IS DISTINCT FROM latest.salesman_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION wa_on_walkin_visit_change() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM wa_sync_latest_walkin(OLD.customer_id);
    RETURN OLD;
  END IF;
  PERFORM wa_sync_latest_walkin(NEW.customer_id);
  IF TG_OP = 'UPDATE' AND OLD.customer_id IS DISTINCT FROM NEW.customer_id THEN
    PERFORM wa_sync_latest_walkin(OLD.customer_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_wa_walkin_visit_change ON wa_walkin_visits;
CREATE TRIGGER trg_wa_walkin_visit_change
  AFTER INSERT OR UPDATE OR DELETE ON wa_walkin_visits
  FOR EACH ROW EXECUTE FUNCTION wa_on_walkin_visit_change();

-- ── Backfill the one visit we still have per person ─────────────────────────
-- Marked is_backfill so nobody later mistakes a reconstructed row for an
-- observed one. Guarded so re-running cannot duplicate it.
INSERT INTO wa_walkin_visits (phone, customer_id, visited_at, salesman_id, timing, is_backfill)
SELECT mnap_ten_digit(c.phone), c.id, c.walkin_at, c.walkin_salesman_id, c.walkin_timing, TRUE
  FROM wa_b_customers c
 WHERE c.walkin_at IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM wa_walkin_visits v
      WHERE v.customer_id = c.id AND v.visited_at = c.walkin_at
   );

GRANT SELECT ON wa_walkin_visits TO authenticated, service_role;
