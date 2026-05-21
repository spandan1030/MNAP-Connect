-- wa_005_enable_realtime.sql
-- Enable Supabase Realtime for the CRM tables so the browser receives
-- live postgres_changes events for new messages and thread updates.

ALTER PUBLICATION supabase_realtime ADD TABLE wa_threads;
ALTER PUBLICATION supabase_realtime ADD TABLE wa_messages;
