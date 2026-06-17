-- wa_021_primary_image.sql  (REQUIRED for primary image / thumbnail)
-- Lets a product mark one photo as primary: used as the grid thumbnail and the
-- default image when sharing with a customer.

ALTER TABLE wa_product_images ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE;

-- Seed: make each product's lowest sort_order photo its primary (where none set yet)
WITH firsts AS (
  SELECT DISTINCT ON (product_id) id
  FROM wa_product_images
  ORDER BY product_id, sort_order, created_at
)
UPDATE wa_product_images SET is_primary = TRUE
WHERE id IN (SELECT id FROM firsts)
  AND product_id NOT IN (SELECT product_id FROM wa_product_images WHERE is_primary);
