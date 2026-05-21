-- wa_006_media_messages.sql
-- Add media support to wa_messages + create Supabase Storage bucket

-- New columns on wa_messages
ALTER TABLE wa_messages
  ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text'
    CHECK (message_type IN ('text', 'image', 'document', 'audio', 'video', 'other')),
  ADD COLUMN IF NOT EXISTS media_url TEXT;

-- Supabase Storage bucket for WhatsApp media files
-- Public bucket so stored images can be rendered directly in the CRM via URL
INSERT INTO storage.buckets (id, name, public)
VALUES ('wa-media', 'wa-media', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload
CREATE POLICY "Authenticated upload wa-media"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'wa-media');

-- Allow anyone to read (public URLs rendered in browser / WhatsApp can fetch them)
CREATE POLICY "Public read wa-media"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'wa-media');

-- Service role can delete/update (for future cleanup)
CREATE POLICY "Service role manage wa-media"
  ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'wa-media')
  WITH CHECK (bucket_id = 'wa-media');
