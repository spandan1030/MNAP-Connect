-- wa_030: unified customer interest signals.
-- One canonical taxonomy (lib/signals.ts) fed by four sources — sales-DB
-- markers, WhatsApp chat tags, cold-call topics, and (future) billing tags —
-- converged on PHONE, the universal key across the Type A / Type B split.
-- Additive & source-attributed: nothing here is overwritten by a pipeline
-- re-import, and this flag never suppresses seeding or other modules.

CREATE TABLE IF NOT EXISTS wa_signals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       TEXT NOT NULL,                 -- 10-digit, no country code
  interest    TEXT NOT NULL,                 -- canonical key (lib/signals INTERESTS)
  source      TEXT NOT NULL,                 -- 'sales' | 'whatsapp' | 'call' | 'billing'
  weight      NUMERIC DEFAULT 1,             -- strength / count of evidence
  evidence    TEXT,                          -- human note (e.g. topic name, "bought")
  last_seen   TIMESTAMPTZ DEFAULT NOW(),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (phone, interest, source)
);

CREATE INDEX IF NOT EXISTS wa_signals_phone_idx    ON wa_signals (phone);
CREATE INDEX IF NOT EXISTS wa_signals_interest_idx ON wa_signals (interest);
CREATE INDEX IF NOT EXISTS wa_signals_source_idx   ON wa_signals (source);

ALTER TABLE wa_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all" ON wa_signals FOR ALL TO authenticated USING (true) WITH CHECK (true);
