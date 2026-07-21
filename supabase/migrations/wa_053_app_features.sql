-- wa_053_app_features.sql
-- ============================================================================
--  CUSTOMER-APP FEATURES ON THE CONTACT SPINE.
--
--  Three new person-level features, all living on `contacts` (the one-row-per-
--  phone spine that customer_features is built FROM), so they are targetable by
--  every rule/chip audience the moment the view is rebuilt (wa_054):
--
--    · app_user             — has an account on the customer app. Fed by the
--                             app-admin export → /api/app-users/import.
--    · has_scheme           — holds a gold-savings scheme in the app. Same feed.
--    · app_product_interest — tapped "interested" / shared a gold.mnalankarpalace.com
--                             product link into WhatsApp. Set by the chat webhook.
--
--  app_product_interest_at stamps the FIRST time we noted it, so the rule builder
--  can ask "showed app interest in the last N days" (a date field, not an event
--  window — there is no per-event log for it, just the flag + first-seen).
--
--  Why on contacts and not wa_b_customers: an app user or a chat-only prospect
--  need not be a billing customer. The spine already carries everyone; the sales
--  tables carry only buyers. Putting these here keeps the app population out of
--  the sales pipeline while still making them a first-class audience feature.
--
--  Idempotent: safe to re-run.
-- ============================================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS app_user             BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS has_scheme           BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS app_product_interest BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS app_product_interest_at TIMESTAMPTZ;

-- Partial indexes: these audiences ask "who is flagged", so index only the TRUE
-- rows — small, and exactly what an app-user / scheme / product-interest cohort
-- scans.
CREATE INDEX IF NOT EXISTS contacts_app_user_idx   ON contacts (phone) WHERE app_user;
CREATE INDEX IF NOT EXISTS contacts_has_scheme_idx  ON contacts (phone) WHERE has_scheme;
CREATE INDEX IF NOT EXISTS contacts_app_interest_idx ON contacts (phone) WHERE app_product_interest;
