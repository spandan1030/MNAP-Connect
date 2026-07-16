-- wa_036_campaigns.sql
-- One row per Reach/thank-you send run, so the funnel report can group by it.
-- Every wa_send_ledger row from a run is stamped with campaign_id. The funnel
-- (delivered/read/replied/converted) is computed live from wa_message_events,
-- inbound wa_messages, and last_purchase_date — this table just anchors the run.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS wa_campaigns (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_label       TEXT,
  template_id        UUID        REFERENCES wa_message_templates(id) ON DELETE SET NULL,
  template_name      TEXT,                                  -- snapshot, survives template deletion
  meta_template_name TEXT,
  category           TEXT,
  filter             JSONB,                                 -- ReachFilter snapshot (nullable)
  total              INT         NOT NULL DEFAULT 0,        -- recipients attempted
  sent               INT         NOT NULL DEFAULT 0,
  failed             INT         NOT NULL DEFAULT 0,
  skipped_suppressed INT         NOT NULL DEFAULT 0,
  skipped_dnc        INT         NOT NULL DEFAULT 0,
  sent_by            UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS wa_campaigns_created_idx ON wa_campaigns(created_at DESC);

ALTER TABLE wa_send_ledger ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES wa_campaigns(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS wa_send_ledger_campaign_idx ON wa_send_ledger(campaign_id) WHERE campaign_id IS NOT NULL;

ALTER TABLE wa_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read campaigns" ON wa_campaigns;
CREATE POLICY "Authenticated read campaigns" ON wa_campaigns
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated manage campaigns" ON wa_campaigns;
CREATE POLICY "Authenticated manage campaigns" ON wa_campaigns
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
