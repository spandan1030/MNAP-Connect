-- wa_018_catalogue_values.sql  (REQUIRED)
-- Adds a Description field, migrates existing notes -> description, and a
-- managed list of allowed values (item_name / design / description / purity /
-- party) that powers dropdowns and lets the owner merge inconsistent naming.

-- 1) Description column
ALTER TABLE wa_products ADD COLUMN IF NOT EXISTS description TEXT;

-- 2) Move existing notes into description, then clear notes
UPDATE wa_products
  SET description = notes, notes = NULL
  WHERE notes IS NOT NULL AND btrim(notes) <> '' AND (description IS NULL OR btrim(description) = '');

-- 3) Managed option values
CREATE TABLE IF NOT EXISTS wa_catalogue_options (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  field      TEXT        NOT NULL CHECK (field IN ('item_name','design','description','purity','party')),
  value      TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS wa_catalogue_options_idx ON wa_catalogue_options (field, value);

ALTER TABLE wa_catalogue_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read catalogue options"
  ON wa_catalogue_options FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated manage catalogue options"
  ON wa_catalogue_options FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- 4) Seed from existing product values
INSERT INTO wa_catalogue_options (field, value)
SELECT DISTINCT 'item_name', btrim(item_name) FROM wa_products WHERE item_name IS NOT NULL AND btrim(item_name) <> ''
ON CONFLICT (field, value) DO NOTHING;
INSERT INTO wa_catalogue_options (field, value)
SELECT DISTINCT 'design', btrim(design) FROM wa_products WHERE design IS NOT NULL AND btrim(design) <> ''
ON CONFLICT (field, value) DO NOTHING;
INSERT INTO wa_catalogue_options (field, value)
SELECT DISTINCT 'description', btrim(description) FROM wa_products WHERE description IS NOT NULL AND btrim(description) <> ''
ON CONFLICT (field, value) DO NOTHING;
INSERT INTO wa_catalogue_options (field, value)
SELECT DISTINCT 'purity', btrim(purity) FROM wa_products WHERE purity IS NOT NULL AND btrim(purity) <> ''
ON CONFLICT (field, value) DO NOTHING;
INSERT INTO wa_catalogue_options (field, value)
SELECT DISTINCT 'party', btrim(party) FROM wa_products WHERE party IS NOT NULL AND btrim(party) <> ''
ON CONFLICT (field, value) DO NOTHING;

-- 5) Seed common purity defaults
INSERT INTO wa_catalogue_options (field, value) VALUES
  ('purity','22K'), ('purity','18K'), ('purity','24K'), ('purity','14K'),
  ('purity','916'), ('purity','750'), ('purity','925')
ON CONFLICT (field, value) DO NOTHING;
