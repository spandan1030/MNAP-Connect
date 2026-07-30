-- wa_056_app_interest_topic.sql
-- Chat interest tag for customers who signal interest in a specific piece from
-- the customer app / website: they shared a `gold.mnalankarpalace.com` product
-- link into WhatsApp, or said "interested" (see webhook `isAppProductInterest`).
--
-- This parallels the existing Daily Rates / New Designs / Offers topics so these
-- customers are tagged in `wa_customer_interests`, surface in the chat
-- "Interested in" banner + the Assign-interests sheet, and mirror into
-- `wa_signals` (canonical key 'app_interest') for unified Reach targeting.
--
-- Idempotent: safe to re-run.

-- Seed the top-level topic (no parent) if it doesn't already exist.
INSERT INTO wa_interest_topics (name, key, topic_group, is_callable, sort_order, is_active)
SELECT 'App Product Interest', 'app_interest', 'engagement', FALSE, 6, TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM wa_interest_topics WHERE key = 'app_interest'
);

-- Adopt a legacy row of the same name that predates the canonical key.
UPDATE wa_interest_topics
   SET key = 'app_interest', topic_group = 'engagement'
 WHERE name = 'App Product Interest' AND key IS NULL;
