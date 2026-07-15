-- wa_033_canonical_topics.sql
-- ONE canonical interest taxonomy. Every source — chat enrollment, chatbot
-- nodes, cold-call topics, sales categories — now maps to the SAME
-- wa_interest_topics.key, replacing the name-regex interpretation
-- (topicNameToInterest) that guessed an interest from a topic's label.
--
--   key         — stable canonical interest slug (matches lib/signals INTERESTS
--                 and the values already stored in wa_signals.interest).
--   topic_group — 'engagement' | 'product' | 'metal' | 'system'.
--   is_callable — TRUE for topics the cold-call screen offers.
--
-- Idempotent: safe to re-run.

ALTER TABLE wa_interest_topics
  ADD COLUMN IF NOT EXISTS key         TEXT,
  ADD COLUMN IF NOT EXISTS topic_group TEXT,
  ADD COLUMN IF NOT EXISTS is_callable BOOLEAN NOT NULL DEFAULT FALSE;

-- Fast lookup by canonical key (many topic rows may share a key, e.g. a parent
-- "Offers" and a child "Sale & Discounts" both roll up to 'offers').
CREATE INDEX IF NOT EXISTS wa_interest_topics_key_idx
  ON wa_interest_topics(key) WHERE key IS NOT NULL;

-- ── Engagement (the four callable ones match lib/calls CALL_TOPICS) ──────────
UPDATE wa_interest_topics SET key='rate',    topic_group='engagement', is_callable=TRUE  WHERE name='Daily Rates';
UPDATE wa_interest_topics SET key='designs', topic_group='engagement', is_callable=TRUE  WHERE name='New Designs';
UPDATE wa_interest_topics SET key='offers',  topic_group='engagement', is_callable=TRUE  WHERE name='Offers';
UPDATE wa_interest_topics SET key='scheme',  topic_group='engagement', is_callable=TRUE  WHERE name='Gold Savings Scheme';
UPDATE wa_interest_topics SET key='repair',  topic_group='engagement'                    WHERE name='Repair & Service';
UPDATE wa_interest_topics SET key='offers',  topic_group='engagement'                    WHERE name='Sale & Discounts';
UPDATE wa_interest_topics SET key='exchange',topic_group='engagement'                    WHERE name='Gold Exchange';
UPDATE wa_interest_topics SET key='cash',    topic_group='engagement'                    WHERE name='Instant Cash';

-- ── Product (New Designs children) ──────────────────────────────────────────
UPDATE wa_interest_topics SET key='necklace',    topic_group='product' WHERE name='Necklaces';
UPDATE wa_interest_topics SET key='ring',        topic_group='product' WHERE name='Rings';
UPDATE wa_interest_topics SET key='bangles',     topic_group='product' WHERE name='Bangles';
UPDATE wa_interest_topics SET key='earrings',    topic_group='product' WHERE name='Earrings';
UPDATE wa_interest_topics SET key='chain',       topic_group='product' WHERE name='Chains';
UPDATE wa_interest_topics SET key='bracelet',    topic_group='product' WHERE name='Bracelets';
UPDATE wa_interest_topics SET key='pendant',     topic_group='product' WHERE name='Pendants';
UPDATE wa_interest_topics SET key='anklet',      topic_group='product' WHERE name='Anklets';
UPDATE wa_interest_topics SET key='mangalsutra', topic_group='product' WHERE name='Mangalsutra';
UPDATE wa_interest_topics SET key='investment',  topic_group='product' WHERE name='Coins';

-- ── System topics — not interests; excluded from wa_signals ─────────────────
UPDATE wa_interest_topics SET key=NULL, topic_group='system' WHERE name IN ('Purchased','Consent','Thank you');

-- ── Metals — add as topics so every wa_signals key has a canonical row ───────
INSERT INTO wa_interest_topics (name, key, topic_group, is_callable, sort_order, is_active)
SELECT v.name, v.key, 'metal', FALSE, 50, TRUE
FROM (VALUES ('Gold','gold'),('Silver','silver'),('Diamond','diamond')) AS v(name, key)
WHERE NOT EXISTS (SELECT 1 FROM wa_interest_topics t WHERE t.key = v.key);
