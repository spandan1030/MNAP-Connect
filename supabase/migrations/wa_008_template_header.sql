-- wa_008_template_header.sql
-- Add image header support to message templates.
-- header_type: 'none' (default) or 'image'
-- header_image_url: publicly accessible URL stored with the template (fixed per template)

ALTER TABLE wa_message_templates
  ADD COLUMN IF NOT EXISTS header_type       text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS header_image_url  text;
