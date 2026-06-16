-- wa_013_topic_sync.sql  (REQUIRED — the bot tags these topics by name)
-- Re-anchor the conversation on the topic tree so captured interests stay in
-- sync with the Send module. Clean up the Schemes/Offers overlap and add the
-- child topics the engagement flow maps to.
--
-- Renames preserve existing wa_customer_interests links (they reference topic_id).
-- Idempotent: safe to run more than once.

-- 1) Clean taxonomy
UPDATE wa_interest_topics SET name = 'Offers'              WHERE name = 'Festive Offers';
UPDATE wa_interest_topics SET name = 'Gold Savings Scheme' WHERE name = 'Schemes & Offers';

-- 2) Children under "Offers" — each Offers-branch choice tags a specific topic
INSERT INTO wa_interest_topics (name, parent_id, sort_order)
SELECT v.name, o.id, v.sort_order
FROM (VALUES
  ('Sale & Discounts', 1),
  ('Gold Exchange',    2),
  ('Instant Cash',     3)
) AS v(name, sort_order)
CROSS JOIN (
  SELECT id FROM wa_interest_topics WHERE name = 'Offers' AND parent_id IS NULL LIMIT 1
) AS o
WHERE NOT EXISTS (
  SELECT 1 FROM wa_interest_topics c WHERE c.name = v.name AND c.parent_id = o.id
);
