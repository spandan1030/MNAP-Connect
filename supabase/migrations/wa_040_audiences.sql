-- wa_040_audiences.sql
-- Audience Library — the modular core of Lead-Gen Phase 1 (LEADGEN_PHASE1_PLAN.md).
-- An AUDIENCE = a saved, named filter over the feature set. It materialises into
-- audience_members (resolve once, reuse across chat/call/ad + reporting). Fixed
-- (frozen snapshot) or dynamic (re-resolves on refresh). Activations (chat sends,
-- call campaigns) link back via audience_id so all comms attribute to the audience.
-- Nothing here touches existing campaign / call data. Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS wa_audiences (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT        NOT NULL,
  description       TEXT,
  filter            JSONB       NOT NULL DEFAULT '{}'::jsonb,   -- a ReachFilter
  is_dynamic        BOOLEAN     NOT NULL DEFAULT FALSE,         -- true = re-resolve on refresh; false = fixed snapshot
  is_active         BOOLEAN     NOT NULL DEFAULT TRUE,
  is_seeded         BOOLEAN     NOT NULL DEFAULT FALSE,         -- part of the pre-made catalogue (§5)
  member_count      INTEGER     NOT NULL DEFAULT 0,
  last_refreshed_at TIMESTAMPTZ,
  created_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audience_members (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  audience_id UUID        NOT NULL REFERENCES wa_audiences(id) ON DELETE CASCADE,
  phone       TEXT        NOT NULL,
  name        TEXT,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (audience_id, phone)
);
CREATE INDEX IF NOT EXISTS audience_members_aid_idx   ON audience_members(audience_id);
CREATE INDEX IF NOT EXISTS audience_members_phone_idx ON audience_members(phone);

-- Attribution: an activation records which audience it came from (nullable — old
-- runs and ad-hoc sends have none). ON DELETE SET NULL so deleting an audience
-- never destroys its historical sends/calls.
ALTER TABLE wa_campaigns        ADD COLUMN IF NOT EXISTS audience_id UUID REFERENCES wa_audiences(id) ON DELETE SET NULL;
ALTER TABLE wa_b_call_campaigns ADD COLUMN IF NOT EXISTS audience_id UUID REFERENCES wa_audiences(id) ON DELETE SET NULL;

ALTER TABLE wa_audiences     ENABLE ROW LEVEL SECURITY;
ALTER TABLE audience_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read audiences" ON wa_audiences;
CREATE POLICY "Authenticated read audiences" ON wa_audiences FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated manage audiences" ON wa_audiences;
CREATE POLICY "Authenticated manage audiences" ON wa_audiences
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated read audience members" ON audience_members;
CREATE POLICY "Authenticated read audience members" ON audience_members FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated manage audience members" ON audience_members;
CREATE POLICY "Authenticated manage audience members" ON audience_members
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
