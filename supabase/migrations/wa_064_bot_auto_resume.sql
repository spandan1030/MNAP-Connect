-- wa_064_bot_auto_resume.sql
-- ============================================================================
--  AUTO-RESUME the auto-reply bot 6h after a handoff / manual pause.
--
--  When a thread hands off to the sales team (bot_state = 'with_agent'), or a
--  staff member taps "BOT OFF", the bot goes silent. Owners forget to switch it
--  back on, so returning customers get ignored. This adds a single timestamp
--  stamped whenever the bot is paused to a human; the webhook flips the thread
--  back to 'active' on the next inbound once 6h have elapsed since that stamp.
--
--    · bot_paused_at — set to now() when bot_state -> 'with_agent' (auto or
--                      manual), cleared to NULL when it returns to 'active'.
--                      NULL for threads that were never paused.
--
--  Additive + nullable; safe to re-run. No backfill: existing paused threads
--  fall back to last_message_at for the 6h clock until their next pause stamps
--  this column.
-- ============================================================================

ALTER TABLE wa_threads ADD COLUMN IF NOT EXISTS bot_paused_at TIMESTAMPTZ;
