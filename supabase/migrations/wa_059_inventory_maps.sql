-- wa_059_inventory_maps.sql  (REQUIRED)
-- Learned/curated mappings that turn messy software values into the clean names
-- shown in Connect and the customer app:
--   1) wa_item_name_map : ITM_ID → clean Connect item name (majority-vote seeded
--                         from already-barcoded products, then learns on manual entry).
--   2) wa_purity_map    : raw software purity → clean purity (a few confident seeds;
--                         the rest are set by the owner in the mapping review screen).
--   3) two security-invoker views the review screen reads to list what's in the
--      master and whether it's mapped yet.

-- ---------------------------------------------------------------------------
-- 1) Item-name map (keyed on the stable ITM_ID, which is 1:1 with a raw name)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wa_item_name_map (
  itm_id      INTEGER     PRIMARY KEY,
  clean_name  TEXT        NOT NULL,          -- the Connect item name fed to the app
  source      TEXT        NOT NULL DEFAULT 'learned' CHECK (source IN ('seed','learned','manual')),
  sample_raw  TEXT,                          -- an example raw software name (for the review UI)
  hits        INTEGER     NOT NULL DEFAULT 1, -- support behind the mapping (majority-vote count)
  updated_by  UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE wa_item_name_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read item name map"
  ON wa_item_name_map FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated manage item name map"
  ON wa_item_name_map FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 2) Purity map (keyed on the normalized raw purity string)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wa_purity_map (
  raw_key     TEXT        PRIMARY KEY,        -- lower(btrim(raw purity))
  raw_sample  TEXT        NOT NULL,           -- original casing for display
  clean       TEXT        NOT NULL,           -- clean purity shown in Connect / app
  source      TEXT        NOT NULL DEFAULT 'seed' CHECK (source IN ('seed','manual')),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE wa_purity_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read purity map"
  ON wa_purity_map FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated manage purity map"
  ON wa_purity_map FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Confident seeds only. Ambiguous silver grades / % ranges / bare decimals are left
-- for the owner to map in the review screen (guessing them wrong is worse than blank).
INSERT INTO wa_purity_map (raw_key, raw_sample, clean, source) VALUES
  ('22k (91.6)', '22K (91.6)', '22K', 'seed'),
  ('18k (750)',  '18K (750)',  '18K', 'seed'),
  ('24 carat',   '24 Carat',   '24K', 'seed'),
  ('0.925',      '0.925',      '925', 'seed')
ON CONFLICT (raw_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3) Review-screen source views (security_invoker → honour the reader's RLS)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW wa_inventory_items
  WITH (security_invoker = true) AS
  SELECT itm_id,
         min(item_name_raw) AS sample_raw,
         count(*)           AS n
    FROM wa_inventory
   WHERE itm_id IS NOT NULL
   GROUP BY itm_id;

CREATE OR REPLACE VIEW wa_inventory_purities
  WITH (security_invoker = true) AS
  SELECT lower(btrim(purity_raw)) AS raw_key,
         min(purity_raw)          AS raw_sample,
         count(*)                 AS n
    FROM wa_inventory
   WHERE purity_raw IS NOT NULL AND btrim(purity_raw) <> ''
   GROUP BY lower(btrim(purity_raw));
