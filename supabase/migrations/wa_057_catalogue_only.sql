-- Catalogue-only (design-only) products.
--
-- A "catalogue product" is a design we show but do NOT physically stock as a
-- specific barcoded piece. It is excluded from inventory (which counts real
-- in-stock pieces) but can still publish to the customer app as a normal
-- product with a live price, carrying a `catalogueOnly` flag so the app can
-- give it a dedicated treatment.

alter table wa_products
  add column if not exists is_catalogue_only boolean not null default false;

comment on column wa_products.is_catalogue_only is
  'Design-only product (not a physical in-stock piece). Excluded from inventory; publishes as a normal product carrying catalogueOnly=true.';

-- One-time backfill: every existing product without a barcode is a design/catalogue
-- item (they have a design but no physical barcoded piece). Reversible per-product.
update wa_products
   set is_catalogue_only = true
 where barcode is null or btrim(barcode) = '';
