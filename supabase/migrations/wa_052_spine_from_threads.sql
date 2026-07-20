-- wa_052_spine_from_threads.sql
-- ============================================================================
--  THE CONTACT SPINE WAS MISSING PEOPLE WHO TALKED TO US.
--
--  `contacts` is meant to be one row per phone — the spine every audience is
--  built on. It was populated by triggers on wa_customers (chat) and
--  wa_b_customers (sales), so a phone only appeared once it had a CUSTOMER
--  record.
--
--  But a WhatsApp thread can exist without one: someone messages us, a thread
--  is created, and unless something enrols them there is no wa_customers row.
--  Those people were therefore absent from `contacts`, absent from
--  `customer_features`, and so INVISIBLE TO EVERY RULE-BASED AUDIENCE — you
--  could not target the very people who started a conversation with you.
--
--  Found by the interval check: "messaged us" returned 40 people from the chat
--  logs but only 35 from the feature view. The 5-person gap was this.
--
--  Fix: a thread is enough to earn a spine row. Chat-only leads become
--  targetable; nothing else changes, because opt-out and naming still come from
--  wherever they came from before.
--
--  Idempotent: safe to re-run.
-- ============================================================================

-- ── 1. A thread now creates / refreshes a spine row ─────────────────────────
CREATE OR REPLACE FUNCTION sync_contact_from_wa_threads() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO contacts (phone, chat_name, from_chat, name)
  VALUES (mnap_ten_digit(NEW.phone), NEW.customer_name, TRUE, NEW.customer_name)
  ON CONFLICT (phone) DO UPDATE SET
    from_chat  = TRUE,
    -- Never overwrite a name we already have with a blank one; a thread's
    -- customer_name is often null for a stranger.
    chat_name  = COALESCE(EXCLUDED.chat_name, contacts.chat_name),
    name       = contact_pick_name(contacts.billing_name,
                                   COALESCE(EXCLUDED.chat_name, contacts.chat_name)),
    updated_at = NOW();
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;  -- never block an inbound message
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_contact_wa_threads ON wa_threads;
CREATE TRIGGER trg_contact_wa_threads
  AFTER INSERT OR UPDATE OF phone, customer_name ON wa_threads
  FOR EACH ROW EXECUTE FUNCTION sync_contact_from_wa_threads();

-- ── 2. Backfill everyone we already have a thread with ──────────────────────
INSERT INTO contacts (phone, chat_name, from_chat, name)
SELECT DISTINCT ON (mnap_ten_digit(t.phone))
       mnap_ten_digit(t.phone), t.customer_name, TRUE, t.customer_name
  FROM wa_threads t
 WHERE mnap_ten_digit(t.phone) <> ''
   AND length(mnap_ten_digit(t.phone)) = 10
 ORDER BY mnap_ten_digit(t.phone), t.last_message_at DESC NULLS LAST
ON CONFLICT (phone) DO UPDATE SET
  from_chat  = TRUE,
  chat_name  = COALESCE(contacts.chat_name, EXCLUDED.chat_name),
  name       = contact_pick_name(contacts.billing_name,
                                 COALESCE(contacts.chat_name, EXCLUDED.chat_name)),
  updated_at = NOW();

-- ── 3. Link any spine row that now has a matching Type A customer ───────────
-- Backfilled rows have no wa_customer_id; fill it where one exists so the
-- profile screens stitch together properly.
UPDATE contacts c
   SET wa_customer_id = w.id
  FROM wa_customers w
 WHERE c.wa_customer_id IS NULL
   AND mnap_ten_digit(w.phone) = mnap_ten_digit(c.phone);
