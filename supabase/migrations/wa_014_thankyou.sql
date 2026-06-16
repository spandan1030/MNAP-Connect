-- wa_014_thankyou.sql  (REQUIRED for the thank-you feature)
-- Per-product thank-you messages + a "Purchased" topic to re-engage buyers.

-- Each row maps a product (from the daily sales report) to a Meta-approved
-- template. One row is the default (used when a buyer has no product, or the
-- product doesn't match any configured row).
CREATE TABLE IF NOT EXISTS wa_thankyou_products (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_label      TEXT        NOT NULL,             -- exact value matched against the upload (case-insensitive)
  is_default         BOOLEAN     NOT NULL DEFAULT FALSE,
  meta_template_name TEXT,                              -- Meta-approved template name (required to actually deliver)
  meta_template_lang TEXT        NOT NULL DEFAULT 'en',
  header_image_url   TEXT,                              -- optional image header (if the template has one)
  body_preview       TEXT        NOT NULL DEFAULT '',   -- what the message looks like, shown in the app
  is_active          BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_by         UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Case-insensitive uniqueness on product label (so matching is unambiguous)
CREATE UNIQUE INDEX IF NOT EXISTS wa_thankyou_products_label_idx
  ON wa_thankyou_products (lower(product_label));

-- At most one default row
CREATE UNIQUE INDEX IF NOT EXISTS wa_thankyou_products_default_idx
  ON wa_thankyou_products (is_default) WHERE is_default = TRUE;

ALTER TABLE wa_thankyou_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read thankyou products"
  ON wa_thankyou_products FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated manage thankyou products"
  ON wa_thankyou_products FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- A top-level "Purchased" topic so buyers form a broadcastable segment.
INSERT INTO wa_interest_topics (name, sort_order)
SELECT 'Purchased', 10
WHERE NOT EXISTS (SELECT 1 FROM wa_interest_topics WHERE name = 'Purchased' AND parent_id IS NULL);
