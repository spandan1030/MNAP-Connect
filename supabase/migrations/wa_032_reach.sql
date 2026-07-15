-- =============================================================
-- MNAP Connect — Reach (unified cohort messaging)  ·  Migration wa_032
--
-- Phase 1 of the Reach feature: message any cohort assembled from call
-- signals, chat signals, markers, or a manual number list — with a
-- phone-keyed send ledger that powers 14-day suppression ("don't pay to
-- send the same message twice") and per-recipient send history.
--
-- Three changes:
--   1. wa_send_ledger  — one row per WhatsApp send attempt, keyed by PHONE
--      (not customer_id) so it works across the Type A / Type B split and
--      the whole call-imported DB. This is the money-guard + funnel spine.
--   2. wa_message_templates — suppression window + category per template.
--   3. wa_b_markers.first_purchase_date — for the customer peek (Phase 2);
--      already computed in the pipeline, added here so re-imports store it.
-- =============================================================

-- 1. Per-template suppression + category ------------------------------------
--    suppression_days: how long the SAME template is blocked per phone.
--      14 = default marketing/thank-you window; 0 = never suppress (daily rate).
--    suppression_bucket: optional group key so several templates can share one
--      window (e.g. all "offer" templates). NULL = suppress per-template.
--    category: coarse label for reporting/peek ('daily_rate','rate','offer','thankyou','custom').
ALTER TABLE wa_message_templates
  ADD COLUMN IF NOT EXISTS suppression_days   INT  NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS suppression_bucket TEXT,
  ADD COLUMN IF NOT EXISTS category           TEXT;

-- 2. First purchase date on the marker snapshot -----------------------------
ALTER TABLE wa_b_markers
  ADD COLUMN IF NOT EXISTS first_purchase_date DATE;

-- 3. wa_send_ledger — phone-keyed record of every send attempt --------------
CREATE TABLE IF NOT EXISTS wa_send_ledger (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone              TEXT        NOT NULL,              -- 10-digit canonical (join key)
  template_id        UUID        REFERENCES wa_message_templates(id) ON DELETE SET NULL,
  meta_template_name TEXT,                              -- snapshot (survives template edit/delete)
  suppression_key    TEXT        NOT NULL,              -- what "same message" means (bucket or template id)
  category           TEXT,                              -- 'daily_rate'|'rate'|'offer'|'thankyou'|'custom'
  status             TEXT        NOT NULL               -- outcome of THIS attempt
                       CHECK (status IN ('sent','failed','skipped_suppressed','skipped_dnc')),
  wa_message_id      TEXT,                              -- Meta wamid on success
  campaign_ref       TEXT,                              -- funnel: originating call campaign id (nullable)
  cohort_label       TEXT,                              -- human label of the cohort at send time
  error              TEXT,
  sent_by            UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  sent_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Suppression lookup: "has this phone had this key sent recently?"
CREATE INDEX IF NOT EXISTS wa_send_ledger_supp_idx
  ON wa_send_ledger (phone, suppression_key, sent_at DESC)
  WHERE status = 'sent';
-- History peek: "everything we ever sent this phone."
CREATE INDEX IF NOT EXISTS wa_send_ledger_phone_idx
  ON wa_send_ledger (phone, sent_at DESC);

ALTER TABLE wa_send_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read send ledger"
  ON wa_send_ledger FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated insert send ledger"
  ON wa_send_ledger FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
