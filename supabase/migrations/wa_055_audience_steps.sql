-- wa_055_audience_steps.sql
-- STEPS — the modular multi-step funnel on an audience.
--
-- An audience gains an ordered list of steps. Each step:
--   1. CARRY  — take a cohort from the PREVIOUS step's outcome (or the whole
--               audience, for step 1). carry_signal ∈ all|delivered|read|replied|connected.
--   2. NARROW — optional marker filter (a RuleTree), resolved by the SAME engine
--               the rest of the app uses (customer_features view).
--   3. ACT    — send a WhatsApp template, or call.
--
-- Every advance signal is EXACTLY attributable to one message (a wamid) or one
-- call log — no time-window heuristics:
--   · delivered / read  — already recorded in wa_message_events, keyed by wamid.
--   · replied           — a quick-reply BUTTON tap. WhatsApp sends context.id =
--                         our step message's wamid; the webhook records it as a
--                         wa_message_events row with status='replied' + the button.
--   · connected         — wa_b_call_logs.success = true for the step's call deck.
--
-- Reuses ALL existing send/call infra: a chat step spawns a wa_campaign + ledger;
-- a call step mints a wa_b_call deck. audience_steps is thin orchestration; the
-- per-step membership snapshot is the funnel's backbone. Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS audience_steps (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  audience_id      UUID        NOT NULL REFERENCES wa_audiences(id) ON DELETE CASCADE,
  seq              INT         NOT NULL,                       -- 1,2,3… order within the audience
  name             TEXT,                                       -- optional label

  -- CARRY: which outcome of the PREVIOUS step feeds this step's input.
  carry_signal     TEXT        NOT NULL DEFAULT 'all',         -- all|delivered|read|replied|connected
  carry_button     TEXT,                                       -- when carry_signal='replied', an optional specific button id

  -- NARROW: optional marker filter over the carried cohort (a RuleTree).
  narrow_rules     JSONB,

  -- ACT
  action           TEXT        NOT NULL,                       -- 'chat' | 'call'
  template_id      UUID        REFERENCES wa_message_templates(id) ON DELETE SET NULL,  -- chat

  -- Lifecycle + the run this step spawned (reuses existing campaign/deck infra).
  status           TEXT        NOT NULL DEFAULT 'draft',       -- draft | run
  campaign_id      UUID        REFERENCES wa_campaigns(id) ON DELETE SET NULL,          -- chat run
  call_campaign_id UUID        REFERENCES wa_b_call_campaigns(id) ON DELETE SET NULL,   -- call run
  entered_count    INT,                                        -- snapshot size at run time
  run_at           TIMESTAMPTZ,

  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (audience_id, seq)
);
CREATE INDEX IF NOT EXISTS audience_steps_aid_idx ON audience_steps(audience_id);

-- Frozen snapshot of who ENTERED each step (a historical fact — never recomputed
-- against changing membership). wa_message_id is the specific step send to this
-- person (chat); it is the join key to wa_message_events for delivered/read/replied.
-- NULL wa_message_id = entered but not sent (opted-out / suppressed / call step).
CREATE TABLE IF NOT EXISTS audience_step_members (
  step_id       UUID        NOT NULL REFERENCES audience_steps(id) ON DELETE CASCADE,
  phone         TEXT        NOT NULL,
  wa_message_id TEXT,
  entered_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (step_id, phone)
);
CREATE INDEX IF NOT EXISTS audience_step_members_step_idx  ON audience_step_members(step_id);
CREATE INDEX IF NOT EXISTS audience_step_members_wamid_idx ON audience_step_members(wa_message_id) WHERE wa_message_id IS NOT NULL;

ALTER TABLE audience_steps        ENABLE ROW LEVEL SECURITY;
ALTER TABLE audience_step_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read audience steps" ON audience_steps;
CREATE POLICY "Authenticated read audience steps" ON audience_steps FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated manage audience steps" ON audience_steps;
CREATE POLICY "Authenticated manage audience steps" ON audience_steps
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated read audience step members" ON audience_step_members;
CREATE POLICY "Authenticated read audience step members" ON audience_step_members FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated manage audience step members" ON audience_step_members;
CREATE POLICY "Authenticated manage audience step members" ON audience_step_members
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
