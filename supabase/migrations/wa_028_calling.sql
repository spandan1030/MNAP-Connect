-- =============================================================
-- MNAP Connect — Cold-Call Module  (Calling + Admin Call Control)
-- Migration: wa_028
-- Lives entirely in mnap-connect, folded into Type B (wa_b_*).
--
-- Flow:
--   Admin uploads the whole DB (customer-signals leads_import.csv) →
--   upsert into wa_b_customers + wa_b_markers. Admin applies marker
--   filters → creates a campaign → generates call tasks (the cards).
--   Salesman works the live cards one at a time, logging each call as
--   Success/Fail, and on success: topic(s) + intent.
--   Admin downloads a feedback CSV (profiles + call markers) → back to
--   the Python pipeline to compute call-level markers.
-- =============================================================

-- -------------------------------------------------------
-- 1. Extend wa_b_customers
-- -------------------------------------------------------
ALTER TABLE wa_b_customers ADD COLUMN IF NOT EXISTS source         TEXT NOT NULL DEFAULT 'enrollment';
                                                                   -- 'enrollment' | 'sales_import'
-- 'Don't call' (intent on a successful call). Enforced by trigger below.
ALTER TABLE wa_b_customers ADD COLUMN IF NOT EXISTS is_do_not_call BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE wa_b_customers ADD COLUMN IF NOT EXISTS dnc_at         TIMESTAMPTZ;

-- -------------------------------------------------------
-- 2. wa_b_markers — imported marker snapshot (1:1 with customer)
--    Hot columns = what the card shows / what admin filters on.
--    Full row kept in JSONB so new markers need no migration.
-- -------------------------------------------------------
CREATE TABLE wa_b_markers (
  customer_id              UUID PRIMARY KEY REFERENCES wa_b_customers(id) ON DELETE CASCADE,
  recency_tier             TEXT,     -- 'Recent' | 'Active' | 'Lapsed'
  value_tier               TEXT,     -- 'VIP' | 'High' | 'Mid' | 'Regular'
  rfm_segment              TEXT,
  frequency_tier           TEXT,     -- 'One-time' | 'Occasional' | 'Repeat' | 'Frequent'
  audience_labels          TEXT[],   -- e.g. {'Lapsed Win-back','High Value','Lookalike Seed'}
  lifetime_value           NUMERIC,
  total_bills              INT,
  days_since_last_purchase INT,
  is_high_value            BOOLEAN,
  is_likely_wedding        BOOLEAN,
  primary_metal            TEXT,
  outreach_bucket          TEXT,
  markers                  JSONB,    -- full marker row (future-proof)
  import_batch             TEXT,
  imported_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -------------------------------------------------------
-- 3. wa_b_call_campaigns — a filtered call list
--    filter_json records the marker filters admin applied (audit + refresh).
-- -------------------------------------------------------
CREATE TABLE wa_b_call_campaigns (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,          -- 'Lapsed VIP Winback — Jul 2026'
  filter_json JSONB,                  -- {recency_tier:['Lapsed'], is_high_value:true, ...}
  created_by  UUID REFERENCES profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE   -- the list salesmen currently see
);

-- -------------------------------------------------------
-- 4. wa_b_call_tasks — one card per customer per campaign
--    Daily-retry model: a Fail hides the card for the rest of TODAY
--    (last_attempt_date = today) and it returns tomorrow. A Success
--    marks it 'done'. 'Don't call' marks it 'hidden' (3-dot menu).
-- -------------------------------------------------------
CREATE TABLE wa_b_call_tasks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       UUID NOT NULL REFERENCES wa_b_call_campaigns(id) ON DELETE CASCADE,
  customer_id       UUID NOT NULL REFERENCES wa_b_customers(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','done','hidden')),
  attempts          INT NOT NULL DEFAULT 0,
  last_attempt_date DATE,             -- gates the "hide today, retry tomorrow" rule
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, customer_id)
);
-- Salesman's live queue = active campaign, status 'pending',
--   AND (last_attempt_date IS NULL OR last_attempt_date < CURRENT_DATE).

-- -------------------------------------------------------
-- 5. wa_b_call_logs — one row per call ATTEMPT
--    Row is created when 'Call' is tapped (success = NULL = attempted,
--    no outcome yet). Updated when the salesman submits the outcome.
-- -------------------------------------------------------
CREATE TABLE wa_b_call_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES wa_b_call_tasks(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES wa_b_customers(id) ON DELETE CASCADE,
  called_by   UUID NOT NULL REFERENCES profiles(id),
  called_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  success     BOOLEAN,                -- NULL = tapped Call, no outcome recorded yet
  -- Section 1 (multi-select, only on success): what the customer is interested in
  topics      TEXT[],                 -- subset of {'rate','designs','offers','booking'}
  -- Section 2 (single-select, only on success): intent to visit
  intent      TEXT,                   -- 'will_come' | 'not_sure' | 'wont_come' | 'dont_call'
  outcome_at  TIMESTAMPTZ,            -- when Success/Fail + result was submitted
  notes       TEXT
);

-- -------------------------------------------------------
-- 6a. On new attempt (Call tapped): bump the task counter + stamp today
--     so the daily-retry gate hides the card for the rest of the day.
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION wa_b_on_call_attempt() RETURNS TRIGGER AS $$
BEGIN
  UPDATE wa_b_call_tasks
     SET attempts          = attempts + 1,
         last_attempt_date = (NEW.called_at)::date,
         updated_at        = NOW()
   WHERE id = NEW.task_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_wa_b_on_call_attempt
  AFTER INSERT ON wa_b_call_logs
  FOR EACH ROW EXECUTE FUNCTION wa_b_on_call_attempt();

-- -------------------------------------------------------
-- 6b. On outcome submit: finalize the task + enforce Don't-call.
--     Success + intent 'dont_call'  → customer DNC + task hidden.
--     Success (any other intent)    → task done.
--     Fail                          → task stays pending (returns tomorrow).
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION wa_b_on_call_outcome() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.success IS NOT NULL
     AND (OLD.success IS DISTINCT FROM NEW.success
          OR OLD.intent IS DISTINCT FROM NEW.intent) THEN

    IF NEW.success AND NEW.intent = 'dont_call' THEN
      UPDATE wa_b_customers
         SET is_do_not_call = TRUE, dnc_at = COALESCE(dnc_at, NOW())
       WHERE id = NEW.customer_id;
      UPDATE wa_b_call_tasks SET status = 'hidden', updated_at = NOW()
       WHERE id = NEW.task_id;
    ELSIF NEW.success THEN
      UPDATE wa_b_call_tasks SET status = 'done', updated_at = NOW()
       WHERE id = NEW.task_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_wa_b_on_call_outcome
  AFTER UPDATE ON wa_b_call_logs
  FOR EACH ROW EXECUTE FUNCTION wa_b_on_call_outcome();

-- -------------------------------------------------------
-- 7. Row Level Security (matches Type B: authenticated read/write;
--    admin-only actions like campaign creation are enforced in the UI)
-- -------------------------------------------------------
ALTER TABLE wa_b_markers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_b_call_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_b_call_tasks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_b_call_logs      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all" ON wa_b_markers        FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON wa_b_call_campaigns FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON wa_b_call_tasks     FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON wa_b_call_logs      FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- -------------------------------------------------------
-- 8. Indexes
-- -------------------------------------------------------
CREATE INDEX ON wa_b_customers    (source);
CREATE INDEX ON wa_b_customers    (is_do_not_call);
CREATE INDEX ON wa_b_markers      (recency_tier, value_tier);
CREATE INDEX ON wa_b_markers      (is_high_value);
CREATE INDEX ON wa_b_call_tasks   (campaign_id, status, last_attempt_date);
CREATE INDEX ON wa_b_call_logs    (customer_id, called_at DESC);
CREATE INDEX ON wa_b_call_logs    (task_id);
CREATE INDEX ON wa_b_call_logs    (success, outcome_at);
