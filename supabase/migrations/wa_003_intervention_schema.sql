-- =============================================================
-- MNAP Connect — Type B Intervention Module Schema
-- Migration: wa_003
-- =============================================================

-- -------------------------------------------------------
-- wa_b_customers
-- Basic customer record for Type B (intervention) module.
-- Kept separate from wa_customers (Type A) until modules merge.
-- -------------------------------------------------------
CREATE TABLE wa_b_customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  phone           TEXT NOT NULL UNIQUE,
  enrolled_by     UUID NOT NULL REFERENCES profiles(id),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -------------------------------------------------------
-- wa_b_profiles
-- All profiling answers for a Type B customer.
-- One row per customer (1:1). Fields are nullable —
-- the form is progressive and not everything is filled
-- at enrollment. Completeness is tracked separately.
-- -------------------------------------------------------
CREATE TABLE wa_b_profiles (
  customer_id             UUID PRIMARY KEY REFERENCES wa_b_customers(id) ON DELETE CASCADE,

  -- Required core (collected at enrollment)
  buying_occasion         TEXT,   -- 'self' | 'wedding' | 'gift' | 'investment' | 'festival' | 'family_occasion'
  purchase_stage          TEXT,   -- 'exploring' | 'comparing' | 'planning' | 'ready'
  budget_range            TEXT,   -- 'under_25k' | '25k_75k' | '75k_2l' | 'above_2l'
  purchase_behavior       TEXT,   -- 'one_time' | 'scheme' | 'exchange' | 'waiting_rates'
  contact_source          TEXT,   -- 'walk_in' | 'whatsapp' | 'social_media' | 'referral' | 'existing_customer'
  competitor_association  TEXT,   -- 'no' | 'just_comparing' | 'somewhat_loyal' | 'very_loyal'

  -- Section A — Product affinity
  product_interests       TEXT[],  -- ['daily_wear','bridal','lightweight','mens','silver','kids','diamond','temple','custom']
  style_preference        TEXT,    -- 'traditional' | 'modern' | 'minimal' | 'statement' | 'trend'

  -- Section B — Timeline & trigger sensitivity
  purchase_timing         TEXT,    -- 'within_7_days' | 'within_1_month' | '1_3_months' | 'browsing'
  notification_interests  TEXT[],  -- ['rate_alerts','new_arrivals','festival','bridal_launches','scheme_updates','making_charge_offers']

  -- Section C — Scheme (signal only — no financial detail)
  has_scheme              BOOLEAN DEFAULT FALSE,
  scheme_with             TEXT,    -- 'mnap' | 'other' (null if no scheme)
  scheme_type             TEXT,    -- 'sip' | 'gold_deposit' | 'other' (null if no scheme)

  -- Section D — Competitor detail (only if competitor_association != 'no')
  competitor_type         TEXT,    -- 'local_family' | 'chain_brand' | 'online' | 'multiple'
  competitor_draw         TEXT[],  -- ['price','designs','trust','location','family_relationship','schemes']

  -- Section E — Relationship temperature (observed by salesman, updated over time)
  engagement_signals      TEXT[],  -- ['asked_specific_designs','asked_photos','visited_store','asked_pricing','compared_elsewhere','discount_focused']
  purchase_history        TEXT,    -- 'first_time' | 'inquired_no_purchase' | 'purchased_before'

  -- Section F — Occasion detail (only if occasion-driven buying)
  occasion_detail         TEXT,    -- free text: wedding month, festival name, anniversary
  purchase_for            TEXT,    -- 'self' | 'partner' | 'parent' | 'child' | 'friend' | 'family'

  -- VIP — manual assignment by salesman
  is_vip                  BOOLEAN NOT NULL DEFAULT FALSE,
  vip_sub_type            TEXT,    -- 'long_time_loyalist' | 'new_exclusive' (null if not VIP)
  vip_assigned_by         UUID REFERENCES profiles(id),
  vip_assigned_at         TIMESTAMPTZ,

  -- Meta
  last_updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by              UUID REFERENCES profiles(id)
);

-- -------------------------------------------------------
-- wa_b_segment_assignments
-- One row per segment assignment, current and historical.
-- When a segment changes: set is_current = false on the old row,
-- insert a new row. Full audit trail of how a customer moved.
-- -------------------------------------------------------
CREATE TABLE wa_b_segment_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     UUID NOT NULL REFERENCES wa_b_customers(id) ON DELETE CASCADE,
  primary_segment TEXT NOT NULL,
  -- plain English explanation of why this segment was assigned
  -- e.g. "Placed in Bridal Journey because: occasion=wedding AND product_interests includes bridal"
  reason          TEXT NOT NULL,
  assigned_by     TEXT NOT NULL,  -- 'system' or salesman user UUID as text
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_current      BOOLEAN NOT NULL DEFAULT TRUE
);

-- Only one current assignment per customer at any time
CREATE UNIQUE INDEX wa_b_segment_assignments_current_unique
  ON wa_b_segment_assignments (customer_id)
  WHERE is_current = TRUE;

-- -------------------------------------------------------
-- wa_b_segment_tags
-- Secondary tags per customer. One row per active tag.
-- Tags are additive and independent of primary segment.
-- -------------------------------------------------------
CREATE TABLE wa_b_segment_tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES wa_b_customers(id) ON DELETE CASCADE,
  tag         TEXT NOT NULL,
  applied_by  TEXT NOT NULL,  -- 'system' or salesman user UUID as text
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

-- No duplicate active tags per customer
CREATE UNIQUE INDEX wa_b_segment_tags_active_unique
  ON wa_b_segment_tags (customer_id, tag)
  WHERE is_active = TRUE;

-- -------------------------------------------------------
-- wa_b_interactions
-- Salesman logs every touchpoint with a Type B customer.
-- Feeds "days since last contact" for dormant detection
-- and journey communication triggers later.
-- -------------------------------------------------------
CREATE TABLE wa_b_interactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      UUID NOT NULL REFERENCES wa_b_customers(id) ON DELETE CASCADE,
  interaction_type TEXT NOT NULL,  -- 'whatsapp' | 'call' | 'store_visit' | 'message_sent' | 'note'
  notes            TEXT,
  logged_by        UUID NOT NULL REFERENCES profiles(id),
  interaction_date DATE NOT NULL,  -- when it actually happened (salesman may log retroactively)
  logged_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -------------------------------------------------------
-- Row Level Security
-- -------------------------------------------------------
ALTER TABLE wa_b_customers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_b_profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_b_segment_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_b_segment_tags      ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_b_interactions      ENABLE ROW LEVEL SECURITY;

-- Authenticated users (salesmen) can read and write all Type B data
CREATE POLICY "auth_all" ON wa_b_customers         FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON wa_b_profiles          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON wa_b_segment_assignments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON wa_b_segment_tags      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON wa_b_interactions      FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- -------------------------------------------------------
-- Indexes for common query patterns
-- -------------------------------------------------------
CREATE INDEX ON wa_b_customers (phone);
CREATE INDEX ON wa_b_customers (enrolled_by);
CREATE INDEX ON wa_b_segment_assignments (customer_id, is_current);
CREATE INDEX ON wa_b_segment_assignments (primary_segment, is_current);
CREATE INDEX ON wa_b_segment_tags (customer_id, is_active);
CREATE INDEX ON wa_b_segment_tags (tag, is_active);
CREATE INDEX ON wa_b_interactions (customer_id, interaction_date DESC);
