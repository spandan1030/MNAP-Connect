-- wa_035_reach_segments.sql
-- Saved Reach segments: name a cohort filter and reuse it (e.g. "Daily rate
-- chat cohort", "Lapsed VIP — gold"). Stores the ReachFilter JSON as-is.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS wa_reach_segments (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  filter     JSONB       NOT NULL,
  created_by UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wa_reach_segments_created_idx ON wa_reach_segments(created_at DESC);

ALTER TABLE wa_reach_segments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read segments" ON wa_reach_segments;
CREATE POLICY "Authenticated read segments" ON wa_reach_segments
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated manage segments" ON wa_reach_segments;
CREATE POLICY "Authenticated manage segments" ON wa_reach_segments
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
