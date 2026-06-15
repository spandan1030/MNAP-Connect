-- wa_010_engagement_flows.sql
-- Rules-based WhatsApp engagement: editable bot copy, per-chat bot state,
-- captured lead signals, and a wider enrolled_via for imported buyers.

-- 1) Editable bot messages (owner edits these from the Engagement admin page).
--    Keyed copy. Offer (and others) may carry an image, sent with the text as caption.
CREATE TABLE IF NOT EXISTS wa_bot_messages (
  key        TEXT        PRIMARY KEY,
  content    TEXT        NOT NULL DEFAULT '',
  image_url  TEXT,
  updated_by UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE wa_bot_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read bot messages"
  ON wa_bot_messages FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated manage bot messages"
  ON wa_bot_messages FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Seed default copy (kept simple + plain; owner edits later)
INSERT INTO wa_bot_messages (key, content) VALUES
  ('welcome',     E'\xF0\x9F\x99\x8F Welcome to M N Alankar Palace!\nHow can we help you today?'),
  ('offer',       E'\xE2\x9C\xA8 Our latest offers are running now! Please visit us to know more.'),
  ('rate_outro',  'Would you like to see anything else?'),
  ('ask_metal',   'Which are you interested in?'),
  ('ask_product', 'Which item would you like to see?'),
  ('ask_designs', 'Shall we send you a few designs?'),
  ('designs_ack', E'Thank you! \xF0\x9F\x99\x8F Our team will send you a few designs shortly.'),
  ('care_prompt', E'Please type your question below. \xF0\x9F\x99\x8F Our team will reply to you shortly.'),
  ('care_ack',    E'Thank you! \xF0\x9F\x99\x8F Our team will reply to you shortly.'),
  ('closing',     E'Okay! \xF0\x9F\x99\x8F If you need anything, just message us anytime.'),
  ('thank_you',   E'Thank you for shopping with M N Alankar Palace! \xF0\x9F\x99\x8F We truly value your trust.')
ON CONFLICT (key) DO NOTHING;

-- 2) Per-chat bot state + a "needs a human" flag for the inbox.
--    active        = bot drives the flow
--    awaiting_care = waiting for the customer to type their question
--    with_agent    = a human has taken over; bot stays silent
ALTER TABLE wa_threads
  ADD COLUMN IF NOT EXISTS bot_state   TEXT    NOT NULL DEFAULT 'active'
    CHECK (bot_state IN ('active', 'awaiting_care', 'with_agent')),
  ADD COLUMN IF NOT EXISTS needs_agent BOOLEAN NOT NULL DEFAULT FALSE;

-- 3) Captured lead signals from the engagement flow (what the customer wants).
CREATE TABLE IF NOT EXISTS wa_lead_captures (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      UUID        REFERENCES wa_customers(id) ON DELETE CASCADE,
  thread_id        UUID        REFERENCES wa_threads(id) ON DELETE CASCADE,
  intent           TEXT,                                   -- 'rate' | 'offers' | 'designs' | 'care'
  metal            TEXT,                                   -- 'gold' | 'silver' | 'diamond'
  product_topic_id UUID        REFERENCES wa_interest_topics(id) ON DELETE SET NULL,
  wants_designs    BOOLEAN,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wa_lead_captures_customer_idx ON wa_lead_captures(customer_id);

ALTER TABLE wa_lead_captures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read lead captures"
  ON wa_lead_captures FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated insert lead captures"
  ON wa_lead_captures FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- 4) Allow buyers imported from the sales-report Excel (Stage 2 thank-you blast).
ALTER TABLE wa_customers DROP CONSTRAINT IF EXISTS wa_customers_enrolled_via_check;
ALTER TABLE wa_customers
  ADD CONSTRAINT wa_customers_enrolled_via_check
  CHECK (enrolled_via IN ('salesman', 'self', 'whatsapp', 'import'));
