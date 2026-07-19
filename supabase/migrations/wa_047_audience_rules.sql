-- wa_047_audience_rules.sql
-- An audience can now be defined by a RULE TREE over customer_features, instead
-- of the legacy ReachFilter shape.
--
--   rules = { groups: [ { rules: [ {field, op, values…, not} ] } ] }
--           groups are OR'd · rules inside a group are AND'd · any rule can be
--           negated. That is the whole grammar.
--
-- NON-DESTRUCTIVE: `filter` stays exactly as it is and keeps working. An
-- audience uses `rules` when present, otherwise `filter` — so every existing
-- audience, every seeded preset and every live campaign is untouched. Nothing
-- is migrated automatically; the two shapes coexist for as long as they need to.
--
-- Idempotent: safe to re-run.

ALTER TABLE wa_audiences
  ADD COLUMN IF NOT EXISTS rules JSONB;

COMMENT ON COLUMN wa_audiences.rules IS
  'Rule tree over customer_features: {groups:[{rules:[…]}]}, groups OR''d, rules within a group AND''d. Takes precedence over `filter` when present.';

-- Find rule-based audiences without scanning the legacy ones.
CREATE INDEX IF NOT EXISTS wa_audiences_rules_idx
  ON wa_audiences ((rules IS NOT NULL)) WHERE rules IS NOT NULL;
