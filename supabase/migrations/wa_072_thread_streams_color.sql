-- wa_072_thread_streams_color.sql
-- ============================================================================
--  TWO MESSAGE STREAMS + CHAT COLOUR-CODING
--
--  (1) last_human_at — a second "last activity" clock that is bumped ONLY by
--      real conversation (customer inbound, bot auto-reply, and staff 1:1 sends/
--      photos/product-shares) and NEVER by campaign/audience broadcasts. The
--      Messages list now splits on it:
--        • Chats      = last_human_at IS NOT NULL  (ordered by last_human_at)
--        • Broadcasts = last_human_at IS NULL       (numbers we've only blasted;
--                        ordered by last_message_at)
--      This means a campaign send to a real conversation no longer jumps it to
--      the top — it only touches last_message_at, which Chats does not sort by.
--
--  (2) color — a manual triage tag set by long-pressing a chat. Fixed palette
--      (see lib/threadColors.ts): hot / unreachable / followup / vip /
--      negotiating / cold. NULL = untagged.
--
--  Idempotent: safe to re-run.
-- ============================================================================

ALTER TABLE wa_threads ADD COLUMN IF NOT EXISTS last_human_at TIMESTAMPTZ;
ALTER TABLE wa_threads ADD COLUMN IF NOT EXISTS color TEXT
  CHECK (color IN ('hot','unreachable','followup','vip','negotiating','cold'));

-- Backfill last_human_at for existing threads: the most recent message that is
-- either inbound, or an outbound that is NOT a campaign send. Campaign sends are
-- the ones dispatch.ts logged a wa_send_ledger row for (matched by wa_message_id);
-- everything else (bot auto-replies, manual free-text/template/photo/share) is
-- real conversation. Threads that have only ever received broadcasts stay NULL
-- and therefore land in the Broadcasts stream.
UPDATE wa_threads t
SET last_human_at = sub.ts
FROM (
  SELECT m.thread_id, MAX(m.created_at) AS ts
  FROM wa_messages m
  LEFT JOIN wa_send_ledger l ON l.wa_message_id = m.wa_message_id
  WHERE m.direction = 'inbound' OR l.wa_message_id IS NULL
  GROUP BY m.thread_id
) sub
WHERE sub.thread_id = t.id;

CREATE INDEX IF NOT EXISTS wa_threads_last_human_idx
  ON wa_threads (last_human_at DESC NULLS LAST);
