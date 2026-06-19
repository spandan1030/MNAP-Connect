-- wa_024_delivery_tracking.sql
-- Phase 1 + 2: richer delivery tracking and per-broadcast reporting.
--
--   1. Keep the Meta error CODE (not just the message text) on failed messages,
--      plus a sent_at timestamp so every message has a full sent→delivered→read clock.
--   2. Log EVERY status callback as its own row (wa_message_events) for a full timeline.
--   3. Group each broadcast run under one wa_broadcasts row so reports can show
--      "this exact send → who got it → status".
--
-- Idempotent: safe to re-run.

-- --- 1. New columns on wa_messages ------------------------------------------
ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS sent_at       TIMESTAMPTZ;
ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS error_code    INTEGER;
ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS error_title   TEXT;
ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS error_details TEXT;
ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS broadcast_id  UUID;

CREATE INDEX IF NOT EXISTS wa_messages_broadcast_id_idx
  ON wa_messages(broadcast_id) WHERE broadcast_id IS NOT NULL;

-- --- 2. One row per broadcast run -------------------------------------------
CREATE TABLE IF NOT EXISTS wa_broadcasts (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id    UUID         REFERENCES wa_message_templates(id) ON DELETE SET NULL,
  template_name  TEXT,                                  -- snapshot, survives template deletion
  topic_id       UUID         REFERENCES wa_interest_topics(id) ON DELETE SET NULL,
  topic_name     TEXT,
  total          INT          NOT NULL DEFAULT 0,        -- recipients attempted
  sent           INT          NOT NULL DEFAULT 0,        -- accepted by Meta at send time
  failed         INT          NOT NULL DEFAULT 0,        -- rejected at send time
  sent_by        UUID         REFERENCES profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wa_broadcasts_created_idx ON wa_broadcasts(created_at DESC);

-- --- 3. Full status timeline (one row per webhook callback) -----------------
CREATE TABLE IF NOT EXISTS wa_message_events (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id     UUID         REFERENCES wa_messages(id) ON DELETE CASCADE,
  wa_message_id  TEXT,                                  -- Meta wamid (kept even if message row missing)
  status         TEXT         NOT NULL,                  -- sent | delivered | read | failed
  error_code     INTEGER,
  error_title    TEXT,
  error_details  TEXT,
  event_at       TIMESTAMPTZ  NOT NULL,                  -- Meta's timestamp for the event
  raw            JSONB,                                  -- full status object, for debugging
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wa_message_events_message_idx ON wa_message_events(message_id);
CREATE INDEX IF NOT EXISTS wa_message_events_wamid_idx   ON wa_message_events(wa_message_id);

-- --- RLS (match the rest of the wa_ tables) ---------------------------------
ALTER TABLE wa_broadcasts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_message_events  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users manage broadcasts" ON wa_broadcasts;
CREATE POLICY "Authenticated users manage broadcasts"
  ON wa_broadcasts FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users read message events" ON wa_message_events;
CREATE POLICY "Authenticated users read message events"
  ON wa_message_events FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
