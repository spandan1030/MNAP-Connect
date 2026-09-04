-- wa_066_coupons.sql
-- ============================================================================
--  COUPON ENGINE — offers (reusable definitions) + coupons (per-customer codes).
--
--  A general coupon system. Its first consumer is the birthday/anniversary
--  module (contacts.birthday_month / anniversary_month, wa_062), but nothing
--  here is occasion-specific — the same engine drives festival / campaign
--  coupons later.
--
--  Model:
--    · wa_coupon_offers — WHAT the offer is (name, discount, terms). Reusable;
--      you make it once and issue many coupons from it.
--    · wa_coupons       — ONE unique code paired to ONE phone, cut from an offer.
--      Its own lifecycle: issued -> sent -> redeemed | void  (expired is derived
--      from valid_until, never stored, so it's always truthful).
--
--  Redemption is a MANUAL mark here (Connect and the billing ERP aren't
--  integrated): staff look the code up, apply the discount in the ERP, and tap
--  "Redeemed" — optionally recording the bill no and who redeemed it.
--
--  Idempotent: safe to re-run.
-- ============================================================================

-- ── Offers ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wa_coupon_offers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,                    -- internal name, e.g. "Birthday 2026"
  description     TEXT,                             -- internal note (not shown to customer)
  -- What KIND of benefit. offer_text is the customer-facing wording used in the
  -- WhatsApp message and everywhere in the UI, so every type has a readable line.
  discount_type   TEXT NOT NULL DEFAULT 'custom'
                    CHECK (discount_type IN ('making_pct','free_gift','flat_amount','total_pct','custom')),
  discount_value  NUMERIC,                          -- the % / ₹ for the numeric types; null for gift/custom
  offer_text      TEXT NOT NULL,                    -- e.g. "20% off making charges" / "Free 5g silver coin"
  min_bill_amount NUMERIC,                          -- optional condition (₹)
  applies_to      TEXT NOT NULL DEFAULT 'all',      -- 'all' | 'gold' | 'silver' | 'diamond' (informational)
  terms           TEXT,                             -- fine print shown to the customer
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,    -- inactive offers can't cut new coupons
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wa_coupon_offers_active_idx ON wa_coupon_offers (is_active) WHERE is_active = TRUE;

-- ── Coupons ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wa_coupons (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code              TEXT NOT NULL UNIQUE,           -- unguessable-ish human code, e.g. MNAP-7F4K2
  offer_id          UUID NOT NULL REFERENCES wa_coupon_offers(id) ON DELETE RESTRICT,
  phone             TEXT NOT NULL,                  -- 10-digit; the pairing — a code belongs to ONE number
  customer_name     TEXT,
  occasion          TEXT,                           -- 'birthday' | 'anniversary' | null — provenance only
  status            TEXT NOT NULL DEFAULT 'issued'
                     CHECK (status IN ('issued','sent','redeemed','void')),
  issued_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  issued_by         UUID,
  sent_at           TIMESTAMPTZ,                    -- when the WhatsApp went out (clock starts here)
  valid_from        TIMESTAMPTZ,                    -- = sent_at
  valid_until       TIMESTAMPTZ,                    -- = sent_at + validity window (30 days)
  wa_message_id     TEXT,                           -- wamid of the coupon message
  redeemed_at       TIMESTAMPTZ,
  redeemed_by       UUID REFERENCES salesmen(id) ON DELETE SET NULL,
  redeemed_bill_no  TEXT,                           -- optional: the bill it was used on
  redeemed_note     TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wa_coupons_phone_idx      ON wa_coupons (phone);
CREATE INDEX IF NOT EXISTS wa_coupons_offer_phone_idx ON wa_coupons (offer_id, phone);
CREATE INDEX IF NOT EXISTS wa_coupons_status_idx     ON wa_coupons (status);
CREATE INDEX IF NOT EXISTS wa_coupons_valid_idx      ON wa_coupons (valid_until);

-- No "one live coupon per (phone, offer)" UNIQUE index: "live" means issued, or
-- sent-and-not-yet-expired, and expiry is time-based — a partial index predicate
-- can't call now(). Enforcing it in the index would also wrongly block RE-issuing
-- the same offer next year (an expired coupon keeps status='sent'). So the
-- "don't double-issue a still-usable coupon" rule lives in issueCoupons(), which
-- is expiry-aware. `code` stays UNIQUE (the one hard guarantee we need).

COMMENT ON TABLE wa_coupons IS
  'One row per issued coupon code, paired to one phone. status issued->sent->redeemed|void; '
  'expired is derived (valid_until < now while still issued/sent), never stored.';

-- ── RLS: authenticated app users read + manage (mirrors wa_customer_feedback) ─
ALTER TABLE wa_coupon_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_coupons       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read offers" ON wa_coupon_offers;
CREATE POLICY "Authenticated read offers" ON wa_coupon_offers
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated manage offers" ON wa_coupon_offers;
CREATE POLICY "Authenticated manage offers" ON wa_coupon_offers
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated read coupons" ON wa_coupons;
CREATE POLICY "Authenticated read coupons" ON wa_coupons
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated manage coupons" ON wa_coupons;
CREATE POLICY "Authenticated manage coupons" ON wa_coupons
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

GRANT SELECT, INSERT, UPDATE, DELETE ON wa_coupon_offers, wa_coupons TO authenticated, service_role;
