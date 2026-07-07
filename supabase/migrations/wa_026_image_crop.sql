-- wa_026_image_crop.sql  (REQUIRED for the 4:5 customer-app crop)
-- Every product photo is presented to customers at a fixed 4:5 (portrait) ratio.
-- We keep the ORIGINAL upload untouched in image_url/thumb_url and store a derived
-- 4:5 crop alongside it. On upload a centered 4:5 crop is generated automatically;
-- staff can reposition the crop frame later. The customer app is fed display_url
-- (falling back to image_url for rows that predate this migration).
--
--   display_url        -- 4:5-cropped full image  (fed to customer app + admin display)
--   display_thumb_url  -- 4:5-cropped grid thumbnail
--   crop               -- normalized crop rect {x,y,w,h} in 0..1 on the original,
--                         so the cropper reopens where the user left it

ALTER TABLE wa_product_images ADD COLUMN IF NOT EXISTS display_url       TEXT;
ALTER TABLE wa_product_images ADD COLUMN IF NOT EXISTS display_thumb_url TEXT;
ALTER TABLE wa_product_images ADD COLUMN IF NOT EXISTS crop              JSONB;
