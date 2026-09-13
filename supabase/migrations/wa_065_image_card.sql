-- wa_065: mid-size "card" rendition for catalogue images.
--
-- The customer-app grids were loading the full 4:5 DISPLAY image (~1280×1600) in
-- every tile — the dominant driver of Supabase cached (CDN) egress. A grid card is
-- ~200px wide (≤600 device-px at 3× DPR), so the full image is ~4× larger than the
-- tile can show. This adds a ~640×800 rendition sized for grid cards: publish sends
-- it as the catalogue doc's `card` field and the app loads it in grids. The full
-- display image is still used on the product detail view (where quality matters).
alter table wa_product_images add column if not exists card_url text;

comment on column wa_product_images.card_url is
  '4:5 mid-size (~640px) rendition the customer-app grids load; NULL falls back to display_url.';
