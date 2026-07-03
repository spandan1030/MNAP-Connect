-- wa_025_app_publish.sql  (REQUIRED for the customer-app catalogue link)
-- Lets a product be published to the M N Alankar Palace CUSTOMER app (a separate
-- Firebase project). Only a sanitized subset is mirrored there (never party,
-- barcode, cost or notes). Publishing is driven from the product page; a Firebase
-- Admin write mirrors the row into the customer app's `catalogue` collection.
--
--   show_in_app     : owner toggles this ON to show the product to customers.
--   making_percent  : making charge as a % of metal value (customer app computes
--                     the live price = metal(from daily rate) + making + GST).
--   app_title       : optional customer-friendly name override (else item_name).
--   app_description : optional marketing copy override (else description).
--   app_synced_at   : last time this row was pushed to the customer app.

ALTER TABLE wa_products
  ADD COLUMN IF NOT EXISTS show_in_app     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS making_percent  NUMERIC,
  ADD COLUMN IF NOT EXISTS app_title       TEXT,
  ADD COLUMN IF NOT EXISTS app_description TEXT,
  ADD COLUMN IF NOT EXISTS app_synced_at   TIMESTAMPTZ;

-- Fast lookup of everything currently published (used by "re-sync all").
CREATE INDEX IF NOT EXISTS wa_products_show_in_app_idx
  ON wa_products (show_in_app) WHERE show_in_app = TRUE;
