-- wa_017_product_status.sql  (REQUIRED)
-- Per-product status flags: sold/in-stock (manual for now) and a QC review flag.

ALTER TABLE wa_products
  ADD COLUMN IF NOT EXISTS is_sold      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS wa_products_review_idx ON wa_products (needs_review) WHERE needs_review = TRUE;
