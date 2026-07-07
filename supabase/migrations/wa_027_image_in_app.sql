-- wa_027_image_in_app.sql  (REQUIRED for multi-photo publishing)
-- Lets a product publish SEVERAL photos to the customer app, not just the primary.
-- Each photo carries an `in_app` flag; the customer-app gallery = photos where
-- (in_app OR is_primary), primary first. The primary is always included so a
-- published product can never end up with zero photos.
--
-- Backfill marks each product's current primary as in_app, so existing published
-- products keep showing exactly the one photo they show today until staff add more.

ALTER TABLE wa_product_images ADD COLUMN IF NOT EXISTS in_app BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE wa_product_images SET in_app = TRUE WHERE is_primary = TRUE;
