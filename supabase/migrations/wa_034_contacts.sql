-- wa_034_contacts.sql
-- The Contact spine: ONE profile per phone, unifying Type A (chat / wa_customers)
-- and Type B (sales + calls / wa_b_customers). Kept in sync automatically by
-- triggers, so every existing write path — enroll, inbound chat (auto-add),
-- STOP, sales import, DNC — reflects here with NO app changes.
--
-- Consent is unified:  is_opted_out = chat STOP (wa_customers.dnd)
--                                  OR call DNC (wa_b_customers.is_do_not_call).
-- The legacy enroll opt-in/opt-out (wa_customers.is_opted_out) is intentionally
-- NOT used here — per the new definition, only STOP/DNC count.
--
-- Triggers are SECURITY DEFINER (so client-side enroll can write contacts) and
-- swallow errors (a contacts hiccup must never roll back a chat reply/enroll).
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS contacts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone            TEXT UNIQUE NOT NULL,
  chat_name        TEXT,
  billing_name     TEXT,
  name             TEXT,                       -- display: billing preferred, else chat
  name_override    TEXT,                       -- manual override (wins in UI)
  wa_customer_id   UUID,                        -- Type A link
  wa_b_customer_id UUID,                        -- Type B link
  from_chat        BOOLEAN NOT NULL DEFAULT FALSE,
  from_sales       BOOLEAN NOT NULL DEFAULT FALSE,
  chat_opted_out   BOOLEAN NOT NULL DEFAULT FALSE,   -- chat STOP
  call_opted_out   BOOLEAN NOT NULL DEFAULT FALSE,   -- call DNC
  is_opted_out     BOOLEAN GENERATED ALWAYS AS (chat_opted_out OR call_opted_out) STORED,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contacts_name_idx   ON contacts (lower(COALESCE(name_override, name)));
CREATE INDEX IF NOT EXISTS contacts_optout_idx ON contacts (is_opted_out);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read contacts" ON contacts;
CREATE POLICY "Authenticated read contacts" ON contacts FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated update contacts" ON contacts;
CREATE POLICY "Authenticated update contacts" ON contacts FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);

-- Pick a display name, avoiding the sales import's 'Unknown' placeholder.
CREATE OR REPLACE FUNCTION contact_pick_name(billing TEXT, chat TEXT) RETURNS TEXT AS $$
  SELECT COALESCE(NULLIF(billing,'Unknown'), NULLIF(chat,'Unknown'), billing, chat);
$$ LANGUAGE sql IMMUTABLE;

-- Type A (chat) -> contacts
CREATE OR REPLACE FUNCTION sync_contact_from_wa_customers() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO contacts (phone, chat_name, wa_customer_id, from_chat, chat_opted_out, name)
  VALUES (NEW.phone, NEW.name, NEW.id, TRUE, COALESCE(NEW.dnd,FALSE), NEW.name)
  ON CONFLICT (phone) DO UPDATE SET
    chat_name      = EXCLUDED.chat_name,
    wa_customer_id = EXCLUDED.wa_customer_id,
    from_chat      = TRUE,
    chat_opted_out = EXCLUDED.chat_opted_out,
    name           = contact_pick_name(contacts.billing_name, EXCLUDED.chat_name),
    updated_at     = NOW();
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;  -- never block enroll / inbound chat / STOP
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Type B (sales + calls) -> contacts
CREATE OR REPLACE FUNCTION sync_contact_from_wa_b_customers() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO contacts (phone, billing_name, wa_b_customer_id, from_sales, call_opted_out, name)
  VALUES (NEW.phone, NEW.name, NEW.id, TRUE, COALESCE(NEW.is_do_not_call,FALSE), NEW.name)
  ON CONFLICT (phone) DO UPDATE SET
    billing_name     = EXCLUDED.billing_name,
    wa_b_customer_id = EXCLUDED.wa_b_customer_id,
    from_sales       = TRUE,
    call_opted_out   = EXCLUDED.call_opted_out,
    name             = contact_pick_name(EXCLUDED.billing_name, contacts.chat_name),
    updated_at       = NOW();
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_contact_wa_customers ON wa_customers;
CREATE TRIGGER trg_contact_wa_customers
  AFTER INSERT OR UPDATE OF name, phone, dnd ON wa_customers
  FOR EACH ROW EXECUTE FUNCTION sync_contact_from_wa_customers();

DROP TRIGGER IF EXISTS trg_contact_wa_b_customers ON wa_b_customers;
CREATE TRIGGER trg_contact_wa_b_customers
  AFTER INSERT OR UPDATE OF name, phone, is_do_not_call ON wa_b_customers
  FOR EACH ROW EXECUTE FUNCTION sync_contact_from_wa_b_customers();

-- ── One-time backfill (bulk upserts; Type B recomputes the display name) ─────
INSERT INTO contacts (phone, chat_name, wa_customer_id, from_chat, chat_opted_out, name, created_at)
SELECT phone, name, id, TRUE, COALESCE(dnd,FALSE), name, created_at FROM wa_customers
ON CONFLICT (phone) DO UPDATE SET
  chat_name=EXCLUDED.chat_name, wa_customer_id=EXCLUDED.wa_customer_id,
  from_chat=TRUE, chat_opted_out=EXCLUDED.chat_opted_out,
  name=contact_pick_name(contacts.billing_name, EXCLUDED.chat_name);

INSERT INTO contacts (phone, billing_name, wa_b_customer_id, from_sales, call_opted_out, name)
SELECT phone, name, id, TRUE, COALESCE(is_do_not_call,FALSE), name FROM wa_b_customers
ON CONFLICT (phone) DO UPDATE SET
  billing_name=EXCLUDED.billing_name, wa_b_customer_id=EXCLUDED.wa_b_customer_id,
  from_sales=TRUE, call_opted_out=EXCLUDED.call_opted_out,
  name=contact_pick_name(EXCLUDED.billing_name, contacts.chat_name);
