-- wa_009_inbound_auto_enroll.sql
-- Allow customers to be auto-enrolled from inbound WhatsApp messages.
-- Inbound contacts are added to wa_customers automatically by the webhook
-- (name from the WhatsApp contact profile, phone from the message), so we
-- need a third enrolled_via value alongside 'salesman' and 'self'.

ALTER TABLE wa_customers DROP CONSTRAINT IF EXISTS wa_customers_enrolled_via_check;

ALTER TABLE wa_customers
  ADD CONSTRAINT wa_customers_enrolled_via_check
  CHECK (enrolled_via IN ('salesman', 'self', 'whatsapp'));
