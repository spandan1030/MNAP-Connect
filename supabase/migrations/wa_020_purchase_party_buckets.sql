-- wa_020_purchase_party_buckets.sql  (REQUIRED for party tracking + weight buckets)
-- Adds a weight bucket (whole grams) to each requirement, and records each
-- purchase as a line tied to the party it was bought from. Approximate weight
-- per party = SUM(qty bought * requirement weight bucket). This is only a buying
-- helper — the catalogue remains the real source of in-stock pieces.

-- 1) Weight bucket on requirements (whole grams: 1, 2, 3, …)
ALTER TABLE wa_purchase_requirements ADD COLUMN IF NOT EXISTS weight_bucket INTEGER;

-- 2) Purchase lines: how many pieces of a requirement were bought from a party
CREATE TABLE IF NOT EXISTS wa_purchase_lines (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id UUID        NOT NULL REFERENCES wa_purchase_requirements(id) ON DELETE CASCADE,
  party          TEXT        NOT NULL,
  qty            INTEGER     NOT NULL DEFAULT 0 CHECK (qty >= 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS wa_purchase_lines_req_party_idx
  ON wa_purchase_lines (requirement_id, party);

ALTER TABLE wa_purchase_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read purchase lines"
  ON wa_purchase_lines FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated manage purchase lines"
  ON wa_purchase_lines FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
