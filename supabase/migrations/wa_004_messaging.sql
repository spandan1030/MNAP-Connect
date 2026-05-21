-- wa_004_messaging.sql
-- WhatsApp CRM: unified message threads and messages table

-- One row per phone number — groups all messages with a contact
CREATE TABLE IF NOT EXISTS wa_threads (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  phone                 TEXT          NOT NULL UNIQUE,            -- 10-digit, no country code
  customer_name         TEXT,                                      -- display name (from wa_customers or WA contact profile)
  customer_id           UUID          REFERENCES wa_customers(id) ON DELETE SET NULL,
  last_message_at       TIMESTAMPTZ,
  last_message_preview  TEXT,                                      -- truncated to 60 chars
  unread_count          INT           NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- All messages: outbound (sent by salesman) and inbound (received from customer)
CREATE TABLE IF NOT EXISTS wa_messages (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id       UUID          NOT NULL REFERENCES wa_threads(id) ON DELETE CASCADE,
  direction       TEXT          NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  wa_message_id   TEXT          UNIQUE,                            -- Meta's wamid — links delivery events back to this row
  body            TEXT,
  template_name   TEXT,                                            -- set for outbound template sends
  status          TEXT          NOT NULL DEFAULT 'queued'
                                CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed', 'received')),
  sent_by         UUID          REFERENCES profiles(id) ON DELETE SET NULL,  -- null for inbound
  delivered_at    TIMESTAMPTZ,
  read_at         TIMESTAMPTZ,
  failed_reason   TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS wa_messages_thread_id_idx      ON wa_messages(thread_id);
CREATE INDEX IF NOT EXISTS wa_messages_wa_message_id_idx  ON wa_messages(wa_message_id) WHERE wa_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS wa_threads_last_message_idx    ON wa_threads(last_message_at DESC NULLS LAST);

-- RLS
ALTER TABLE wa_threads  ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users manage threads"
  ON wa_threads FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users manage messages"
  ON wa_messages FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
