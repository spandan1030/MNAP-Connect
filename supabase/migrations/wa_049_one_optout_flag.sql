-- wa_049_one_optout_flag.sql
-- ============================================================================
--  ONE OPT-OUT FLAG.
--
--  There were SEVEN columns for one idea:
--      wa_customers.dnd              (chat STOP)
--      wa_customers.is_opted_out     (a second Type-A flag, set alongside dnd)
--      wa_b_customers.is_do_not_call (salesman marked don't-call)
--      contacts.chat_opted_out       (a mirror of dnd)
--      contacts.call_opted_out       (a mirror of is_do_not_call)
--      contacts.manual_opted_out     (Customer Book toggle, wa_037)
--      contacts.is_opted_out         (GENERATED: the OR of the three mirrors)
--
--  Because is_opted_out was GENERATED it could not be written to, so every
--  screen picked whichever underlying column it happened to know about. Two live
--  paths (1:1 inbox send, catalogue share) checked only the chat half, which
--  meant a customer who told a salesman "don't contact me" could still be
--  messaged and sent products. That is the policy being wrong, not just untidy.
--
--  AFTER THIS:
--    · contacts.is_opted_out is a REAL, WRITABLE column — the single truth.
--      Every read in the app uses it. Every write goes through set_opt_out().
--    · chat_opted_out / call_opted_out survive only as PROVENANCE — "how did
--      this happen" — and no longer decide anything on their own.
--    · The legacy columns are kept in lockstep by trigger, because the pipeline
--      round-trip (call_feedback.csv) reads is_do_not_call and the Type A
--      screens still read dnd. Nothing outside has to change at once.
--
--  Writes flow DOWN (contacts -> legacy) and legacy edits still flow UP, so a
--  direct write to either old column is still honoured. Both directions guard
--  with IS DISTINCT FROM, so the pair cannot ping-pong.
--
--  Idempotent: safe to re-run.
-- ============================================================================

-- ── 1. Make the flag real ───────────────────────────────────────────────────
-- Drop the generated column and rebuild it as plain data, preserving state.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS opt_out_reason TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS opted_out_at TIMESTAMPTZ;

-- `customer_features` selects contacts.is_opted_out, so the column cannot be
-- dropped while that view exists — and renaming it just renames it inside the
-- view too, which is why a plain rename-then-drop fails.
--
-- So: capture the view's own definition FIRST (it still says `is_opted_out`),
-- drop it, swap the column, then rebuild the view from the captured text. It
-- re-binds to the new plain column of the same name. No need to re-run wa_046,
-- and no copy of the 200-line view definition kept here to drift out of date.
DO $$
DECLARE
  v      RECORD;
  -- Two parallel arrays, NOT one delimited string: a view definition can
  -- legitimately contain any separator character (|| for concatenation, for one),
  -- so splitting on a delimiter would corrupt the SQL we are about to re-run.
  names  TEXT[] := '{}';
  defs   TEXT[] := '{}';
  -- Dropping a view also drops its GRANTs and its COMMENT. customer_features
  -- grants SELECT to authenticated + service_role; lose that and every audience
  -- screen in the app starts returning nothing. So both get carried across too.
  grants TEXT[] := '{}';
  notes  TEXT[] := '{}';
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'contacts' AND column_name = 'is_opted_out'
       AND is_generated = 'ALWAYS'
  ) THEN
    -- Find EVERY view built on this column, not just the one we know about.
    -- Their definitions still say `is_opted_out`, which is the name the new
    -- plain column will take, so a captured definition rebinds cleanly.
    --
    -- COLLECT FIRST, DROP AFTER: dropping inside this loop would mutate the very
    -- catalog tables the loop is reading.
    FOR v IN
      SELECT DISTINCT dep.relname AS name, pg_get_viewdef(dep.oid, true) AS def
        FROM pg_depend d
        JOIN pg_rewrite r   ON r.oid = d.objid
        JOIN pg_class dep   ON dep.oid = r.ev_class
        JOIN pg_class src   ON src.oid = d.refobjid
        JOIN pg_attribute a ON a.attrelid = src.oid AND a.attnum = d.refobjsubid
       WHERE src.relname = 'contacts'
         AND a.attname   = 'is_opted_out'
         AND dep.relkind = 'v'
         AND dep.relname <> 'contacts'
    LOOP
      names := array_append(names, v.name);
      defs  := array_append(defs,  v.def);

      grants := array_append(grants, COALESCE((
        SELECT string_agg(
                 format('GRANT %s ON %I TO %I;', g.privilege_type, g.table_name, g.grantee),
                 ' ')
          FROM information_schema.role_table_grants g
         WHERE g.table_schema = 'public' AND g.table_name = v.name
      ), ''));

      notes := array_append(notes, COALESCE(
        obj_description(format('public.%I', v.name)::regclass, 'pg_class'), ''));
    END LOOP;

    -- Deliberately NOT cascading. If something we did not capture depends on
    -- one of these, we want this migration to STOP and name it, rather than
    -- quietly delete a view it will never rebuild. Failing here costs nothing:
    -- the whole block is one transaction and rolls back untouched.
    IF array_length(names, 1) IS NOT NULL THEN
      FOR i IN 1 .. array_length(names, 1) LOOP
        EXECUTE format('DROP VIEW %I', names[i]);
        RAISE NOTICE 'wa_049: captured and dropped view % (will rebuild)', names[i];
      END LOOP;
    END IF;

    ALTER TABLE contacts RENAME COLUMN is_opted_out TO is_opted_out_gen;
    ALTER TABLE contacts ADD COLUMN is_opted_out BOOLEAN NOT NULL DEFAULT FALSE;
    UPDATE contacts SET is_opted_out = COALESCE(is_opted_out_gen, FALSE);
    ALTER TABLE contacts DROP COLUMN is_opted_out_gen;

    -- Rebuild in reverse, so a view that fed another is recreated first.
    -- array_length is NULL (not 0) on an empty array, hence the guard.
    IF array_length(names, 1) IS NOT NULL THEN
      FOR i IN REVERSE array_length(names, 1) .. 1 LOOP
        EXECUTE format('CREATE VIEW %I AS %s', names[i], defs[i]);
        IF notes[i] <> '' THEN
          EXECUTE format('COMMENT ON VIEW %I IS %L', names[i], notes[i]);
        END IF;
        IF grants[i] <> '' THEN
          EXECUTE grants[i];
        END IF;
        RAISE NOTICE 'wa_049: rebuilt view % (grants and comment restored)', names[i];
      END LOOP;
    END IF;
  END IF;
END $$;

-- Belt and braces: whatever route we took, state matches the old OR.
-- MUST include manual_opted_out (wa_037) or every Customer Book opt-out is lost.
UPDATE contacts
   SET is_opted_out = TRUE
 WHERE is_opted_out IS DISTINCT FROM TRUE
   AND (COALESCE(chat_opted_out, FALSE)
     OR COALESCE(call_opted_out, FALSE)
     OR COALESCE(manual_opted_out, FALSE));

CREATE INDEX IF NOT EXISTS contacts_optout_idx ON contacts (is_opted_out);

COMMENT ON COLUMN contacts.is_opted_out IS
  'THE opt-out flag. Do not contact: no WhatsApp, no calls. Ads are unaffected '
  'by design. Write via set_opt_out(); never write the legacy columns directly.';
COMMENT ON COLUMN contacts.chat_opted_out IS 'Provenance only — they sent STOP. Does not decide anything.';
COMMENT ON COLUMN contacts.call_opted_out IS 'Provenance only — marked on a call. Does not decide anything.';

-- ── 2. The one way to change it ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_opt_out(
  target_phone TEXT,
  value        BOOLEAN,
  reason       TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  p TEXT := mnap_ten_digit(target_phone);
BEGIN
  UPDATE contacts c
     SET is_opted_out   = value,
         opt_out_reason = CASE WHEN value THEN COALESCE(reason, c.opt_out_reason) ELSE NULL END,
         opted_out_at   = CASE WHEN value THEN COALESCE(c.opted_out_at, NOW()) ELSE NULL END,
         -- Provenance: record which channel asked, without it becoming the rule.
         chat_opted_out   = CASE WHEN reason = 'chat_stop' AND value THEN TRUE
                                 WHEN NOT value THEN FALSE ELSE c.chat_opted_out END,
         call_opted_out   = CASE WHEN reason = 'call_dnc'  AND value THEN TRUE
                                 WHEN NOT value THEN FALSE ELSE c.call_opted_out END,
         manual_opted_out = CASE WHEN reason = 'manual'    AND value THEN TRUE
                                 WHEN NOT value THEN FALSE ELSE c.manual_opted_out END,
         updated_at     = NOW()
   WHERE mnap_ten_digit(c.phone) = p
     AND c.is_opted_out IS DISTINCT FROM value;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 3. Keep the legacy columns in lockstep (contacts -> old tables) ─────────
-- The pipeline export and the older Type A screens still read these.
CREATE OR REPLACE FUNCTION mirror_opt_out_down() RETURNS TRIGGER AS $$
BEGIN
  -- wa_customers carries BOTH dnd and its own is_opted_out; keep them together
  -- or the inbox and the broadcast screens disagree about the same person.
  UPDATE wa_customers w
     SET dnd          = NEW.is_opted_out,
         is_opted_out = NEW.is_opted_out,
         opted_out_at = CASE WHEN NEW.is_opted_out THEN COALESCE(w.opted_out_at, NOW()) ELSE NULL END
   WHERE w.id = NEW.wa_customer_id
     AND (w.dnd IS DISTINCT FROM NEW.is_opted_out
       OR w.is_opted_out IS DISTINCT FROM NEW.is_opted_out);

  UPDATE wa_b_customers b
     SET is_do_not_call = NEW.is_opted_out
   WHERE b.id = NEW.wa_b_customer_id
     AND b.is_do_not_call IS DISTINCT FROM NEW.is_opted_out;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;  -- never block an opt-out from being recorded
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_mirror_opt_out_down ON contacts;
CREATE TRIGGER trg_mirror_opt_out_down
  AFTER UPDATE OF is_opted_out ON contacts
  FOR EACH ROW EXECUTE FUNCTION mirror_opt_out_down();

-- ── 4. Legacy writes still flow up ──────────────────────────────────────────
-- Anything still writing dnd / is_do_not_call directly must be honoured. These
-- REPLACE the wa_034 versions: same name-syncing behaviour, plus they now raise
-- the single flag instead of only setting their own half.
CREATE OR REPLACE FUNCTION sync_contact_from_wa_customers() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO contacts (phone, chat_name, wa_customer_id, from_chat, chat_opted_out, is_opted_out, name)
  VALUES (NEW.phone, NEW.name, NEW.id, TRUE, COALESCE(NEW.dnd,FALSE), COALESCE(NEW.dnd,FALSE), NEW.name)
  ON CONFLICT (phone) DO UPDATE SET
    chat_name      = EXCLUDED.chat_name,
    wa_customer_id = EXCLUDED.wa_customer_id,
    from_chat      = TRUE,
    chat_opted_out = EXCLUDED.chat_opted_out,
    -- A STOP opts out. Clearing dnd only un-opts when NO other reason stands.
    is_opted_out   = CASE
                       WHEN EXCLUDED.chat_opted_out THEN TRUE
                       ELSE COALESCE(contacts.call_opted_out, FALSE)
                         OR COALESCE(contacts.manual_opted_out, FALSE)
                     END,
    name           = contact_pick_name(contacts.billing_name, EXCLUDED.chat_name),
    updated_at     = NOW();
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION sync_contact_from_wa_b_customers() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO contacts (phone, billing_name, wa_b_customer_id, from_sales, call_opted_out, is_opted_out, name)
  VALUES (NEW.phone, NEW.name, NEW.id, TRUE, COALESCE(NEW.is_do_not_call,FALSE), COALESCE(NEW.is_do_not_call,FALSE), NEW.name)
  ON CONFLICT (phone) DO UPDATE SET
    billing_name     = EXCLUDED.billing_name,
    wa_b_customer_id = EXCLUDED.wa_b_customer_id,
    from_sales       = TRUE,
    call_opted_out   = EXCLUDED.call_opted_out,
    is_opted_out     = CASE
                         WHEN EXCLUDED.call_opted_out THEN TRUE
                         ELSE COALESCE(contacts.chat_opted_out, FALSE)
                           OR COALESCE(contacts.manual_opted_out, FALSE)
                       END,
    name             = contact_pick_name(EXCLUDED.billing_name, contacts.chat_name),
    updated_at       = NOW();
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 5. Reconcile everything that already exists ─────────────────────────────
-- Push the unified answer back down, so the old columns agree from day one.
UPDATE wa_customers w
   SET dnd = c.is_opted_out, is_opted_out = c.is_opted_out
  FROM contacts c
 WHERE c.wa_customer_id = w.id
   AND (w.dnd IS DISTINCT FROM c.is_opted_out
     OR w.is_opted_out IS DISTINCT FROM c.is_opted_out);

UPDATE wa_b_customers b
   SET is_do_not_call = c.is_opted_out
  FROM contacts c
 WHERE c.wa_b_customer_id = b.id
   AND b.is_do_not_call IS DISTINCT FROM c.is_opted_out;
