-- wa_042_ad_leads.sql
-- Ad-lead capture (LEADGEN_PHASE1_PLAN.md §7). When ads run, a Click-to-WhatsApp
-- lead's first inbound carries a referral (ad id / ctwa_clid); other platforms use
-- a tracked wa.me code. We record the lead + which campaign so a follow-up chat/call
-- audience (AD1) can target them. INERT until the Meta/WhatsApp-ads connection is
-- wired — tables just stay empty. Idempotent.

CREATE TABLE IF NOT EXISTS ad_campaigns (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT        NOT NULL UNIQUE,     -- tracked code / referral source_id
  name       TEXT        NOT NULL,
  product    TEXT,                            -- e.g. 'gold_bangles'
  platform   TEXT,                            -- meta | google | other
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wa_ad_leads (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        TEXT        NOT NULL,
  ad_campaign  TEXT,                          -- ad_campaigns.code (nullable if unknown)
  source_id    TEXT,                          -- Meta ad id (referral.source_id)
  ctwa_clid    TEXT,                          -- click-to-WhatsApp click id
  headline     TEXT,                          -- referral.headline (context)
  first_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  replied      BOOLEAN     NOT NULL DEFAULT FALSE,
  followed_up  BOOLEAN     NOT NULL DEFAULT FALSE,
  converted    BOOLEAN     NOT NULL DEFAULT FALSE,
  UNIQUE (phone, ad_campaign)
);
CREATE INDEX IF NOT EXISTS wa_ad_leads_phone_idx    ON wa_ad_leads(phone);
CREATE INDEX IF NOT EXISTS wa_ad_leads_campaign_idx ON wa_ad_leads(ad_campaign);

ALTER TABLE ad_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_ad_leads  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read ad_campaigns" ON ad_campaigns;
CREATE POLICY "Authenticated read ad_campaigns" ON ad_campaigns FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated manage ad_campaigns" ON ad_campaigns;
CREATE POLICY "Authenticated manage ad_campaigns" ON ad_campaigns
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated read ad_leads" ON wa_ad_leads;
CREATE POLICY "Authenticated read ad_leads" ON wa_ad_leads FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated manage ad_leads" ON wa_ad_leads;
CREATE POLICY "Authenticated manage ad_leads" ON wa_ad_leads
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
