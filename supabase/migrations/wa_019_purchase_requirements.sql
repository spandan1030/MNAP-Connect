-- wa_019_purchase_requirements.sql  (REQUIRED for Purchase mode)
-- A buying checklist: how many pieces of an item/design/description/purity are
-- needed, and how many have been purchased so far. Pure planning — it does not
-- touch the catalogue; staff still add the actual pieces via Add product.

CREATE TABLE IF NOT EXISTS wa_purchase_requirements (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name     TEXT,
  design        TEXT,
  description   TEXT,
  purity        TEXT,
  qty_needed    INTEGER     NOT NULL DEFAULT 1 CHECK (qty_needed >= 0),
  qty_purchased INTEGER     NOT NULL DEFAULT 0 CHECK (qty_purchased >= 0),
  notes         TEXT,
  is_done       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE wa_purchase_requirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read purchase requirements"
  ON wa_purchase_requirements FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated manage purchase requirements"
  ON wa_purchase_requirements FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
