-- wa_069_ad_lead_topic.sql
-- ============================================================================
--  "Ad Lead" as a first-class interest — like Offers / Daily Rate / Designs.
--
--  Every Click-to-WhatsApp lead is already captured in wa_ad_leads. This makes
--  them a recognisable, targetable GROUP:
--    · a canonical interest topic (key='ad_lead') so it shows in the chat
--      "Assign interests" sheet and anywhere topics/keys are listed;
--    · matches the new INTERESTS entry in lib/signals.ts (key 'ad_lead').
--
--  Plus a ONE-TIME backfill: write an 'ad_lead' signal for every existing ad
--  lead, so leads captured before this change also carry the attribute. Source
--  is 'whatsapp' (they arrived via WhatsApp); evidence 'ad lead' distinguishes
--  it from an ordinary chat tag. Idempotent (ON CONFLICT DO NOTHING).
-- ============================================================================

-- Canonical topic. Guarded so re-running never duplicates it.
INSERT INTO wa_interest_topics (name, key, topic_group, is_callable, sort_order, is_active)
SELECT 'Ad Lead', 'ad_lead', 'engagement', FALSE, 40, TRUE
WHERE NOT EXISTS (SELECT 1 FROM wa_interest_topics t WHERE t.key = 'ad_lead');

-- One-time backfill of existing ad leads into the unified signal spine.
INSERT INTO wa_signals (phone, interest, source, weight, evidence, last_seen)
SELECT phone, 'ad_lead', 'whatsapp', 1, 'ad lead', first_seen
  FROM wa_ad_leads
 WHERE ctwa_clid IS NOT NULL OR source_id IS NOT NULL
ON CONFLICT (phone, interest, source) DO NOTHING;
