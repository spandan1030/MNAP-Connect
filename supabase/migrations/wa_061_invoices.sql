-- wa_061_invoices.sql
-- ============================================================================
--  PER-INVOICE RECORDS  (for the private "View invoice" link feature).
--
--  Source of truth is the raw billing-ERP export (JSP_RTL_INVC + _ORN), which is
--  Bill×Barcode grained: one CSV row per item, many rows per bill. The importer
--  (/api/invoices/import) GROUPS those rows by bill number into one row here:
--    · header fields (amount/tax/net/old-metal/advance/phone) — bill level
--    · line_items JSONB — one entry per barcode {item, purity, net_wt, barcode, amount}
--
--  Each bill gets an unguessable `token` (the capability that unlocks its public
--  page — never the bill number, which is sequential). The page is published to
--  Firestore and messaged only at SEND time, so expires_at (7 days) starts when
--  the customer receives it, not when we import.
--
--  Lifecycle columns:
--    token        — random, generated once on first import; never changes.
--    sent_at      — the Utility template went out (set by the send flow).
--    published_at — snapshot written to Firestore (set by the send flow).
--    expires_at   — sent_at + 7d; the page 410s past this and Firestore TTL purges.
--
--  Why here (mnap-connect) and not the store app: this app owns WhatsApp sending,
--  opt-out, suppression and the send ledger — the invoice link rides that exact
--  machinery. The store app only renders the page from the Firestore snapshot.
--
--  Idempotent: safe to re-run. Re-importing a bill is a no-op (insert-new-only by
--  bill_no), so tokens and send state are never disturbed.
-- ============================================================================

CREATE TABLE IF NOT EXISTS wa_invoices (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_no            TEXT        NOT NULL,                       -- RI_VRNO, natural idempotency key
  token              TEXT        NOT NULL,                       -- unguessable capability for the public URL
  phone              TEXT        NOT NULL,                       -- normalized 10-digit
  customer_name      TEXT,
  invoice_date       DATE,
  amount_before_tax  NUMERIC(12,2),                             -- RI_AMT
  tax_amount         NUMERIC(12,2),                             -- RI_TAX_AMT
  net_amount         NUMERIC(12,2),                             -- RI_NET_AMT (items, incl. tax, foot to this)
  old_metal_amount   NUMERIC(12,2),                             -- OA_AMT
  advance_amount     NUMERIC(12,2),                             -- AR_AMT
  payable            NUMERIC(12,2),                             -- net - old_metal - advance (computed at import)
  line_items         JSONB       NOT NULL DEFAULT '[]'::jsonb,  -- [{item,purity,net_wt,barcode,amount}]
  import_batch       TEXT,
  imported_by        UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  sent_at            TIMESTAMPTZ,
  published_at       TIMESTAMPTZ,
  expires_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per bill; one page per token.
CREATE UNIQUE INDEX IF NOT EXISTS wa_invoices_bill_no_idx ON wa_invoices (bill_no);
CREATE UNIQUE INDEX IF NOT EXISTS wa_invoices_token_idx   ON wa_invoices (token);

-- The send screen scans "imported but not yet sent" — index only those.
CREATE INDEX IF NOT EXISTS wa_invoices_unsent_idx ON wa_invoices (created_at) WHERE sent_at IS NULL;
-- Peek / history by phone.
CREATE INDEX IF NOT EXISTS wa_invoices_phone_idx ON wa_invoices (phone);

ALTER TABLE wa_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read invoices"
  ON wa_invoices FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated manage invoices"
  ON wa_invoices FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
