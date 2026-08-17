-- wa_063_invoice_tracking.sql
-- ============================================================================
--  PER-BILL ENGAGEMENT TRACKING for the invoice ("Bill Summary") links, and
--  wiring invoice sends into the campaign report as ONE rolling "Invoice links"
--  campaign (wa_campaigns row, category = 'invoice').
--
--  Adds to wa_invoices:
--    · wa_message_id  — the outbound WhatsApp message id, so delivery/read events
--                       (wa_message_events, keyed by wamid) attribute to THIS bill.
--    · campaign_id    — the rolling "Invoice links" wa_campaigns row the send joined,
--                       so invoice sends show up in the Campaigns list + funnel.
--    · reviewed_at / review_rating            — captured on the Bill Summary page.
--    · birthday_submitted_at /
--      anniversary_submitted_at               — captured on the Bill Summary page.
--    · opened_at / website_visited_at         — schema-ready for the page-open ping +
--                                               outbound-click beacon (wired in a
--                                               later instrumentation pass; NULL for now).
--
--  All columns are additive + nullable; safe to re-run.
-- ============================================================================

ALTER TABLE wa_invoices ADD COLUMN IF NOT EXISTS wa_message_id            TEXT;
ALTER TABLE wa_invoices ADD COLUMN IF NOT EXISTS campaign_id              UUID REFERENCES wa_campaigns(id) ON DELETE SET NULL;
ALTER TABLE wa_invoices ADD COLUMN IF NOT EXISTS reviewed_at              TIMESTAMPTZ;
ALTER TABLE wa_invoices ADD COLUMN IF NOT EXISTS review_rating            SMALLINT CHECK (review_rating BETWEEN 1 AND 5);
ALTER TABLE wa_invoices ADD COLUMN IF NOT EXISTS birthday_submitted_at    TIMESTAMPTZ;
ALTER TABLE wa_invoices ADD COLUMN IF NOT EXISTS anniversary_submitted_at TIMESTAMPTZ;
ALTER TABLE wa_invoices ADD COLUMN IF NOT EXISTS opened_at                TIMESTAMPTZ;   -- Phase 2: page-open ping
ALTER TABLE wa_invoices ADD COLUMN IF NOT EXISTS website_visited_at       TIMESTAMPTZ;   -- Phase 2: outbound-click beacon

-- Report joins: bills of a campaign, and wamid -> delivery/read events.
CREATE INDEX IF NOT EXISTS wa_invoices_campaign_idx ON wa_invoices (campaign_id)   WHERE campaign_id   IS NOT NULL;
CREATE INDEX IF NOT EXISTS wa_invoices_wamid_idx    ON wa_invoices (wa_message_id) WHERE wa_message_id IS NOT NULL;
