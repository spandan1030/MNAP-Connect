-- wa_060_product_has_photo.sql  (REQUIRED for the catalogue "Photo" filter)
-- Maintains a denormalized wa_products.has_photo flag so the catalogue can filter
-- "has photo / no photo" server-side (correct pagination + counts) without an
-- anti-join. Kept in sync by a trigger on wa_product_images.

ALTER TABLE wa_products
  ADD COLUMN IF NOT EXISTS has_photo BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill from current images.
UPDATE wa_products p
  SET has_photo = EXISTS (SELECT 1 FROM wa_product_images i WHERE i.product_id = p.id);

CREATE INDEX IF NOT EXISTS wa_products_has_photo_idx ON wa_products (has_photo);

-- Recompute a single product's flag from the image table (source of truth).
CREATE OR REPLACE FUNCTION wa_sync_has_photo() RETURNS TRIGGER AS $$
DECLARE pid UUID;
BEGIN
  pid := COALESCE(NEW.product_id, OLD.product_id);
  UPDATE wa_products p
    SET has_photo = EXISTS (SELECT 1 FROM wa_product_images i WHERE i.product_id = pid)
    WHERE p.id = pid;
  RETURN NULL; -- AFTER trigger; return value ignored
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS wa_product_images_has_photo ON wa_product_images;
CREATE TRIGGER wa_product_images_has_photo
  AFTER INSERT OR DELETE ON wa_product_images
  FOR EACH ROW EXECUTE FUNCTION wa_sync_has_photo();
