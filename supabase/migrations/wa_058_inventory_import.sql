-- wa_058_inventory_import.sql  (REQUIRED)
-- Foundation for the inventory-import system:
--   1) wa_inventory      : master table, one row per software barcode (import target).
--   2) wa_products.stock_status : richer per-piece status (in_stock | sold | deleted),
--                          fed to the customer app. Publish stays TOGGLE-ONLY — this
--                          status never gates show_in_app / is_active.
--   3) wa_products.party_id     : numeric supplier id from the software (name mapped later).
--   4) wa_products.design_code  : app-facing per-piece code (MN000001…), auto-assigned,
--                          shown WITH the barcode in Connect, and the ONLY code sent to
--                          the customer app (raw barcode is never exposed).
--   5) XMNAP backfill    : catalogue-only pieces with no barcode get an internal
--                          XMNAP##### barcode so every piece is keyed.

-- ---------------------------------------------------------------------------
-- 1) Inventory master (one row per software barcode)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wa_inventory (
  barcode            TEXT        PRIMARY KEY,     -- software barcode (unique, e.g. A12345678)
  itm_id             INTEGER,                     -- stable item id (1:1 with a raw item name)
  item_name_raw      TEXT,                        -- messy software name (aliases/shortforms)
  party_id           INTEGER,                     -- supplier id (no name in the export)
  dsgn_id            INTEGER,
  design_raw         TEXT,
  purt_id            INTEGER,
  purity_raw         TEXT,                        -- e.g. "22K (91.6)", "0.925", "Silver."
  grd_id             INTEGER,
  grade_raw          TEXT,
  net_weight         NUMERIC,                     -- grams
  bcm_creation_date  TIMESTAMPTZ,                 -- barcode creation
  bcm_status         TEXT,                        -- raw: New | Sale | Deleted | Estm | Approval | Remove
  sold_date          TIMESTAMPTZ,
  deleted_date       TIMESTAMPTZ,
  source_file        TEXT,                        -- filename of the upload that last touched this row
  imported_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wa_inventory_itm_idx    ON wa_inventory (itm_id);
CREATE INDEX IF NOT EXISTS wa_inventory_status_idx ON wa_inventory (bcm_status);
-- Prefix search for the Add+ barcode autocomplete (case-insensitive "starts with").
CREATE INDEX IF NOT EXISTS wa_inventory_barcode_prefix_idx
  ON wa_inventory (lower(barcode) text_pattern_ops);

ALTER TABLE wa_inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read inventory"
  ON wa_inventory FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated manage inventory"
  ON wa_inventory FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 2) Richer product status  (in_stock | sold | deleted)
--    NOTE: informational only — it does NOT control app visibility. Publishing
--    is driven solely by show_in_app. Backfill mirrors the existing is_sold flag.
-- ---------------------------------------------------------------------------
ALTER TABLE wa_products
  ADD COLUMN IF NOT EXISTS stock_status TEXT NOT NULL DEFAULT 'in_stock'
    CHECK (stock_status IN ('in_stock','sold','deleted')),
  ADD COLUMN IF NOT EXISTS party_id INTEGER;

UPDATE wa_products
  SET stock_status = CASE WHEN is_sold THEN 'sold' ELSE 'in_stock' END
  WHERE stock_status = 'in_stock';   -- only rows still at the default

CREATE INDEX IF NOT EXISTS wa_products_stock_status_idx ON wa_products (stock_status);

-- ---------------------------------------------------------------------------
-- 3) App-facing design code (per piece, auto-assigned MN######)
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS wa_design_code_seq;

ALTER TABLE wa_products ADD COLUMN IF NOT EXISTS design_code TEXT;

CREATE OR REPLACE FUNCTION wa_assign_design_code() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.design_code IS NULL OR btrim(NEW.design_code) = '' THEN
    NEW.design_code := 'MN' || lpad(nextval('wa_design_code_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS wa_products_design_code ON wa_products;
CREATE TRIGGER wa_products_design_code
  BEFORE INSERT ON wa_products
  FOR EACH ROW EXECUTE FUNCTION wa_assign_design_code();

-- Backfill existing rows in creation order (oldest = lowest code).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM wa_products WHERE design_code IS NULL ORDER BY created_at, id LOOP
    UPDATE wa_products
      SET design_code = 'MN' || lpad(nextval('wa_design_code_seq')::text, 6, '0')
      WHERE id = r.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS wa_products_design_code_idx ON wa_products (design_code);

-- ---------------------------------------------------------------------------
-- 4) XMNAP internal barcodes for catalogue-only pieces that have none.
--    (Real software barcodes are letter+8 digits, so XMNAP##### never collides.)
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS wa_xmnap_seq;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT id FROM wa_products
     WHERE is_catalogue_only = TRUE
       AND (barcode IS NULL OR btrim(barcode) = '')
     ORDER BY created_at, id
  LOOP
    UPDATE wa_products
      SET barcode = 'XMNAP' || lpad(nextval('wa_xmnap_seq')::text, 5, '0')
      WHERE id = r.id;
  END LOOP;
END $$;
