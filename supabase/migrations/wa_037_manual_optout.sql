-- wa_037_manual_optout.sql
-- A third way to opt someone out of all comms: a MANUAL flag a salesman sets
-- from the Customer Book. It joins the two existing signals (chat STOP, call DNC)
-- in the ONE source of truth — contacts.is_opted_out — so consent stays unified:
--
--   is_opted_out = chat STOP  OR  call DNC  OR  manual opt-out
--
-- Reach resolve/send already gate on contacts.is_opted_out, so this needs no
-- send-path change. Idempotent: safe to re-run.

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS manual_opted_out    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS manual_opted_out_at TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS manual_opted_out_by UUID;

-- Rebuild the generated column to include the manual flag. (A generated column's
-- expression can't be ALTERed in place — drop and re-add. Dropping it also drops
-- its index, so recreate that too.)
ALTER TABLE contacts DROP COLUMN IF EXISTS is_opted_out;
ALTER TABLE contacts ADD COLUMN is_opted_out BOOLEAN
  GENERATED ALWAYS AS (chat_opted_out OR call_opted_out OR manual_opted_out) STORED;
CREATE INDEX IF NOT EXISTS contacts_optout_idx ON contacts (is_opted_out);
