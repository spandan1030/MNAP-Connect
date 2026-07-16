-- wa_038_campaign_members.sql
-- Campaigns become a PERSISTENT cohort you finish over time, not a one-shot run.
--   • wa_campaigns gains: name, is_dynamic (auto-pull new matches vs fixed
--     snapshot), status, last_refreshed_at.
--   • wa_campaign_members = the full eligible cohort, materialised. Reach creates
--     the campaign with all members and (optionally) blasts the first N; the rest
--     stay as members you send to later from the campaign page. Sends are still
--     tracked in wa_send_ledger (campaign_id), so the funnel is computed live.
-- Idempotent: safe to re-run.

ALTER TABLE wa_campaigns ADD COLUMN IF NOT EXISTS name              TEXT;
ALTER TABLE wa_campaigns ADD COLUMN IF NOT EXISTS is_dynamic        BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE wa_campaigns ADD COLUMN IF NOT EXISTS status            TEXT NOT NULL DEFAULT 'active';   -- active | done
ALTER TABLE wa_campaigns ADD COLUMN IF NOT EXISTS last_refreshed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS wa_campaign_members (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID        NOT NULL REFERENCES wa_campaigns(id) ON DELETE CASCADE,
  phone       TEXT        NOT NULL,
  name        TEXT,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, phone)
);
CREATE INDEX IF NOT EXISTS wa_campaign_members_cid_idx ON wa_campaign_members(campaign_id);

ALTER TABLE wa_campaign_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read campaign members" ON wa_campaign_members;
CREATE POLICY "Authenticated read campaign members" ON wa_campaign_members
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated manage campaign members" ON wa_campaign_members;
CREATE POLICY "Authenticated manage campaign members" ON wa_campaign_members
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
