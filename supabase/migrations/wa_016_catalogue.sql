-- wa_016_catalogue.sql  (REQUIRED)
-- Product catalogue: details + multiple photos per item. Two-phase friendly —
-- everything is nullable so a record can be saved with just details, just a
-- photo, or both, and completed later.

CREATE TABLE IF NOT EXISTS wa_products (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name   TEXT,
  barcode     TEXT,
  weight      NUMERIC,                       -- grams
  purity      TEXT,                          -- e.g. 22KT, 18KT, 916, 925
  design      TEXT,
  party       TEXT,                          -- supplier / vendor
  notes       TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_by  UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One catalogue record per physical barcode tag (case-insensitive; blanks allowed)
CREATE UNIQUE INDEX IF NOT EXISTS wa_products_barcode_idx
  ON wa_products (lower(barcode)) WHERE barcode IS NOT NULL AND barcode <> '';

CREATE INDEX IF NOT EXISTS wa_products_created_idx ON wa_products (created_at DESC);

CREATE TABLE IF NOT EXISTS wa_product_images (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID        NOT NULL REFERENCES wa_products(id) ON DELETE CASCADE,
  image_url   TEXT        NOT NULL,
  sort_order  INT         NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wa_product_images_product_idx ON wa_product_images (product_id);

ALTER TABLE wa_products       ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_product_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read products"
  ON wa_products FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated manage products"
  ON wa_products FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated read product images"
  ON wa_product_images FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated manage product images"
  ON wa_product_images FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
