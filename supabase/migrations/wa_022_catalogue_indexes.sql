-- wa_022_catalogue_indexes.sql  (RECOMMENDED before loading many products)
-- Indexes that keep the catalogue fast once there are thousands of products.
-- The page now filters/sorts/paginates on the server, so these back those queries.

-- Ordering + range pagination
CREATE INDEX IF NOT EXISTS wa_products_created_at_idx   ON wa_products (created_at DESC);

-- Equality filters (item/design/description/purity/party + status flags)
CREATE INDEX IF NOT EXISTS wa_products_item_name_idx    ON wa_products (item_name);
CREATE INDEX IF NOT EXISTS wa_products_design_idx       ON wa_products (design);
CREATE INDEX IF NOT EXISTS wa_products_description_idx  ON wa_products (description);
CREATE INDEX IF NOT EXISTS wa_products_purity_idx       ON wa_products (purity);
CREATE INDEX IF NOT EXISTS wa_products_party_idx        ON wa_products (party);
CREATE INDEX IF NOT EXISTS wa_products_is_sold_idx      ON wa_products (is_sold);
CREATE INDEX IF NOT EXISTS wa_products_needs_review_idx ON wa_products (needs_review);
CREATE INDEX IF NOT EXISTS wa_products_weight_idx       ON wa_products (weight);

-- Fast "primary photo per product" lookups for thumbnails
CREATE INDEX IF NOT EXISTS wa_product_images_primary_idx
  ON wa_product_images (product_id) WHERE is_primary;

-- Trigram indexes so the search box (ILIKE %text%) stays fast at scale
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS wa_products_item_name_trgm
  ON wa_products USING gin (item_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS wa_products_barcode_trgm
  ON wa_products USING gin (barcode gin_trgm_ops);
