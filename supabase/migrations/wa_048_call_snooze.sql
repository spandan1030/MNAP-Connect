-- wa_048_call_snooze.sql
-- ============================================================================
--  CALL SUPPRESSION v2 — the wait now depends on WHAT HAPPENED on the last call.
--
--  Before (wa_044): one flat 2-day cooldown after any attempt.
--  Now:
--    · last call FAILED (didn't connect)      -> wait 4 days
--    · last call CONNECTED, said "will come"  -> wait 4 days   (hot lead, stays reachable)
--    · last call CONNECTED, anything else     -> wait 30 days  (we already spoke; don't pester)
--    · last call PENDING (outcome not saved)  -> wait 4 days   (treat as an attempt)
--    · never called                           -> callable now
--
--  Unchanged from wa_044: 4 DISCONNECTS retires them from calling entirely.
--  That is a separate, harder rule and still lives in failed_call_attempts.
--
--  WHY A STORED DATE, not a rule in every query: three decks ask "may I call this
--  person" (Call Control, audience activation, the salesman's deck). Encoding the
--  branching in each one guarantees they drift apart. Here it is computed ONCE,
--  by trigger, and every deck asks the same trivial question:
--        call_snooze_until IS NULL OR call_snooze_until <= today
--
--  Recomputed from the call log (never incremented), so it self-heals: correct an
--  outcome from Fail to Success and the wait re-derives correctly on the spot.
--
--  Idempotent: safe to re-run.
-- ============================================================================

-- ── 1. The column ───────────────────────────────────────────────────────────
ALTER TABLE wa_b_customers
  ADD COLUMN IF NOT EXISTS call_snooze_until DATE;

COMMENT ON COLUMN wa_b_customers.call_snooze_until IS
  'Do not serve a call card before this date. Maintained by trigger from the most '
  'recent call log: failed/pending +4d, connected +30d, connected "will come" +4d.';

CREATE INDEX IF NOT EXISTS wa_b_customers_snooze_idx
  ON wa_b_customers (call_snooze_until);

-- ── 2. The rule, in one place ───────────────────────────────────────────────
-- Kept as a function so the numbers live at exactly one point in the database.
CREATE OR REPLACE FUNCTION wa_b_call_snooze_days(succeeded BOOLEAN, intent TEXT)
RETURNS INT AS $$
  SELECT CASE
    -- Spoke to them and they did NOT commit to visiting: leave them alone a month.
    WHEN succeeded IS TRUE AND COALESCE(intent, '') <> 'will_come' THEN 30
    -- Everything else (no answer, pending outcome, or "will come") is the short wait.
    ELSE 4
  END;
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION wa_b_sync_call_state(cid UUID) RETURNS VOID AS $$
DECLARE
  last_call  RECORD;
BEGIN
  IF cid IS NULL THEN RETURN; END IF;

  -- The most recent call decides the wait — earlier calls do not extend it.
  SELECT l.called_at, l.success, l.intent
    INTO last_call
    FROM wa_b_call_logs l
   WHERE l.customer_id = cid
   ORDER BY l.called_at DESC
   LIMIT 1;

  UPDATE wa_b_customers c
     SET failed_call_attempts = (
           SELECT COUNT(*) FROM wa_b_call_logs l
            WHERE l.customer_id = cid AND l.success IS FALSE
         ),
         call_snooze_until = CASE
           WHEN last_call.called_at IS NULL THEN NULL
           ELSE (last_call.called_at AT TIME ZONE 'Asia/Kolkata')::date
                + wa_b_call_snooze_days(last_call.success, last_call.intent)
         END
   WHERE c.id = cid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Keep the wa_044 name working for anything that still calls it.
CREATE OR REPLACE FUNCTION wa_b_sync_failed_calls(cid UUID) RETURNS VOID AS $$
  SELECT wa_b_sync_call_state(cid);
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION wa_b_on_call_log_change() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM wa_b_sync_call_state(OLD.customer_id);
    RETURN OLD;
  END IF;
  PERFORM wa_b_sync_call_state(NEW.customer_id);
  IF TG_OP = 'UPDATE' AND OLD.customer_id IS DISTINCT FROM NEW.customer_id THEN
    PERFORM wa_b_sync_call_state(OLD.customer_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_wa_b_on_call_log_change ON wa_b_call_logs;
CREATE TRIGGER trg_wa_b_on_call_log_change
  AFTER INSERT OR UPDATE OR DELETE ON wa_b_call_logs
  FOR EACH ROW EXECUTE FUNCTION wa_b_on_call_log_change();

-- ── 3. Backfill from all history ────────────────────────────────────────────
-- Applies the new rule to everyone already called, including the live winback
-- campaign, so it starts obeying this immediately rather than at the next call.
WITH latest AS (
  SELECT DISTINCT ON (customer_id)
         customer_id, called_at, success, intent
    FROM wa_b_call_logs
   ORDER BY customer_id, called_at DESC
)
UPDATE wa_b_customers c
   SET call_snooze_until =
         (l.called_at AT TIME ZONE 'Asia/Kolkata')::date
         + wa_b_call_snooze_days(l.success, l.intent)
  FROM latest l
 WHERE c.id = l.customer_id;

-- Anyone with no calls at all is callable.
UPDATE wa_b_customers c
   SET call_snooze_until = NULL
 WHERE c.call_snooze_until IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM wa_b_call_logs l WHERE l.customer_id = c.id);
