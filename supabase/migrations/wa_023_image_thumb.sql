-- wa_023_image_thumb.sql  (RECOMMENDED for fast catalogue thumbnails)
-- Stores a small (~320px) thumbnail URL alongside the full image. The grid uses
-- thumb_url so it downloads tiny files; detail/preview/share use the full image.
-- Existing rows have no thumb yet — the app falls back to image_url for those.

ALTER TABLE wa_product_images ADD COLUMN IF NOT EXISTS thumb_url TEXT;
