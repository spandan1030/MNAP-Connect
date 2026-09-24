-- wa_068_ad_lead_capi.sql
-- ============================================================================
--  Conversions API (CAPI) for Click-to-WhatsApp ad leads.
--
--  A CTWA lead who sends a SECOND message is an engaged human (not an accidental
--  tap). We fire one Meta CAPI "Lead" event for them — keyed on the stored
--  ctwa_clid (no phone matching needed) — so Meta learns to find more people like
--  them instead of optimising only for "someone opened a chat".
--
--    · lead_event_sent_at — set the moment we successfully send that Lead event.
--      NULL = not yet sent; the webhook fires the event once and stamps this, so a
--      3rd/4th message never re-sends. Additive + nullable; safe to re-run.
--
--  INERT until the CAPI env is provisioned (META_CAPI_DATASET_ID, META_WABA_ID,
--  META_CAPI_ACCESS_TOKEN) — until then the webhook helper no-ops and this column
--  simply stays NULL.
-- ============================================================================

ALTER TABLE wa_ad_leads ADD COLUMN IF NOT EXISTS lead_event_sent_at TIMESTAMPTZ;
