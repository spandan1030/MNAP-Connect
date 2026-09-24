-- wa_067_bot_message_enabled.sql
-- ============================================================================
--  Per-message ON/OFF switch for auto-reply copy.
--
--  Promotional replies (e.g. the festive `rate_lock_offer` and the generic
--  `offer`) are time-bound: when the campaign ends the owner must be able to
--  stop customers receiving that message when they tap the button or arrive
--  from an ad — WITHOUT deleting the copy (they'll reuse it next festival).
--
--    · enabled — when FALSE the webhook skips this message and falls back to
--                the normal welcome flow. Defaults TRUE so every existing +
--                unset message keeps behaving exactly as before.
--
--  Additive + non-null with a default; safe to re-run. Only the promotional
--  keys are actually gated in code (see webhook route.ts `isBotKeyEnabled`);
--  core-flow keys always send regardless, so an accidental toggle can't break
--  the bot.
-- ============================================================================

ALTER TABLE wa_bot_messages ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE;
