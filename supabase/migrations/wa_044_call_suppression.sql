-- wa_044 — CALL SUPPRESSION RULES (governance made live)
--
-- Two rules, both enforced off ONE denormalized counter so every caller of the
-- deck (Call Control, audience activation, the live winback campaign) obeys them
-- without special-casing:
--
--   R1 COOLDOWN     a card that was attempted is not re-served for >= 2 days.
--                   (Was: returns the very next day.) Enforced at read time via
--                   last_attempt_date < today - 1  — see lib/calls.ts.
--
--   R2 UNREACHABLE  a customer with >= 4 DISCONNECTED calls drops out of every
--                   calling deck. "Disconnected" = wa_b_call_logs.success = FALSE
--                   ONLY. success IS NULL (tapped Call, outcome not yet
--                   submitted = pending) is NOT counted, so an unfinished card
--                   can never suppress anyone.
--
-- Non-destructive: nothing is deleted and no task status is rewritten. The rows,
-- their history and their DNC state stay exactly as they are — they are simply
-- filtered out of the deck. Relax the threshold and they come back.
-- The customer stays reachable on chat/ads (audience A5 `callUnresponsive`).

-- ── 1. The counter ──────────────────────────────────────────────────────────
ALTER TABLE wa_b_customers
  ADD COLUMN IF NOT EXISTS failed_call_attempts INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN wa_b_customers.failed_call_attempts IS
  'Count of wa_b_call_logs with success = FALSE (disconnects only; pending NULL outcomes excluded). Maintained by trigger. >= 4 hides the customer from all calling decks.';

CREATE INDEX IF NOT EXISTS wa_b_customers_failed_calls_idx
  ON wa_b_customers (failed_call_attempts);

-- ── 2. Keep it in sync ──────────────────────────────────────────────────────
-- Recomputed from source (not incremented) so it self-heals: an outcome edited
-- from Fail -> Success correctly decrements, and a deleted log is accounted for.
CREATE OR REPLACE FUNCTION wa_b_sync_failed_calls(cid UUID) RETURNS VOID AS $$
BEGIN
  IF cid IS NULL THEN RETURN; END IF;
  UPDATE wa_b_customers c
     SET failed_call_attempts = (
           SELECT COUNT(*) FROM wa_b_call_logs l
            WHERE l.customer_id = cid AND l.success IS FALSE
         )
   WHERE c.id = cid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION wa_b_on_call_log_change() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM wa_b_sync_failed_calls(OLD.customer_id);
    RETURN OLD;
  END IF;
  PERFORM wa_b_sync_failed_calls(NEW.customer_id);
  -- customer_id reassignment is not expected, but stay correct if it happens.
  IF TG_OP = 'UPDATE' AND OLD.customer_id IS DISTINCT FROM NEW.customer_id THEN
    PERFORM wa_b_sync_failed_calls(OLD.customer_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_wa_b_on_call_log_change ON wa_b_call_logs;
CREATE TRIGGER trg_wa_b_on_call_log_change
  AFTER INSERT OR UPDATE OR DELETE ON wa_b_call_logs
  FOR EACH ROW EXECUTE FUNCTION wa_b_on_call_log_change();

-- ── 3. Backfill from all history (covers the live winback campaign) ─────────
UPDATE wa_b_customers c
   SET failed_call_attempts = COALESCE(f.n, 0)
  FROM (
    SELECT customer_id, COUNT(*) AS n
      FROM wa_b_call_logs
     WHERE success IS FALSE
     GROUP BY customer_id
  ) f
 WHERE c.id = f.customer_id
   AND c.failed_call_attempts IS DISTINCT FROM f.n;

-- Supports the deck query: pending tasks, cooled-down, of the live campaign.
CREATE INDEX IF NOT EXISTS wa_b_call_tasks_deck_idx
  ON wa_b_call_tasks (campaign_id, status, last_attempt_date);
