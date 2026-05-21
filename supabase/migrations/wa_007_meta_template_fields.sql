-- wa_007_meta_template_fields.sql
-- Link internal templates to Meta-approved WhatsApp Business templates.
-- meta_template_name  : the name exactly as registered in Meta Business Manager
-- meta_template_lang  : language code (en, en_US, hi, etc.)
-- meta_variables      : ordered JSON array mapping our placeholders to {{1}}, {{2}}...
--                       e.g. ["name","rate_24kt","rate_22kt","rate_18kt"]
--                       {{1}} = customer name, {{2}} = 24kt rate, etc.

ALTER TABLE wa_message_templates
  ADD COLUMN IF NOT EXISTS meta_template_name TEXT,
  ADD COLUMN IF NOT EXISTS meta_template_lang TEXT NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS meta_variables     JSONB;
