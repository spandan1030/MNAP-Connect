-- wa_045 — fix the seed_key unique index so ON CONFLICT can use it.
--
-- wa_043 created it PARTIAL (`WHERE seed_key IS NOT NULL`). Postgres only matches a
-- partial index to an ON CONFLICT clause that repeats the identical predicate, and
-- PostgREST sends a bare `ON CONFLICT (seed_key)` — hence:
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
-- when seeding the preset audiences.
--
-- The predicate was never needed: a plain UNIQUE index already permits unlimited
-- NULLs (Postgres treats NULLs as distinct), so user-made audiences — which have no
-- seed_key — stay unconstrained, exactly as before. Duplicate protection for the
-- presets is unchanged. Idempotent.

DROP INDEX IF EXISTS wa_audiences_seed_key_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS wa_audiences_seed_key_uidx
  ON wa_audiences (seed_key);
