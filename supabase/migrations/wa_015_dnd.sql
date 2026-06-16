-- wa_015_dnd.sql  (REQUIRED)
-- Do-Not-Disturb: a customer who sends STOP is flagged and never messaged again
-- (by any path — auto-reply, 1:1, broadcast, thank-you) until they send START.

ALTER TABLE wa_customers
  ADD COLUMN IF NOT EXISTS dnd BOOLEAN NOT NULL DEFAULT FALSE;

-- Editable copy for the opt-out notice + confirmation
INSERT INTO wa_bot_messages (key, content) VALUES
  ('stop_notice', 'Message STOP any time to stop receiving messages.'),
  ('stop_ack',    E'You have been unsubscribed. \xF0\x9F\x99\x8F You will not receive any more messages from us. Message START anytime to resume.')
ON CONFLICT (key) DO NOTHING;
