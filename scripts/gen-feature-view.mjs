// Generates supabase/migrations/wa_045_customer_features.sql — the one-row-per-
// person feature view.
//
// WHY THIS IS GENERATED: the view needs two columns per interest
// (int_<key>_src, int_<key>_at) in two places each. Hand-writing ~92 lines that
// must stay in step with lib/signals.ts is exactly the drift we're designing out:
// add an interest there, re-run this, the columns exist. The taxonomy lives in
// ONE file.
//
//   node scripts/gen-feature-view.mjs
//
// Re-run after editing INTERESTS in lib/signals.ts, then apply the migration.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ── Read the canonical interest keys out of lib/signals.ts ──────────────────
const src = readFileSync(join(root, 'lib', 'signals.ts'), 'utf8')
const block = src.match(/export const INTERESTS:\s*InterestDef\[\]\s*=\s*\[([\s\S]*?)\n\]/)
if (!block) throw new Error('Could not find the INTERESTS array in lib/signals.ts')
const keys = [...block[1].matchAll(/\{\s*key:\s*'([a-z_]+)'/g)].map(m => m[1])
if (keys.length < 20) throw new Error(`Only parsed ${keys.length} interests — the INTERESTS format changed, fix this script.`)
if (new Set(keys).size !== keys.length) throw new Error('Duplicate interest keys in lib/signals.ts')

// ── The two generated fragments ─────────────────────────────────────────────
const sigAggregates = keys.map(k =>
  `    array_agg(DISTINCT source) FILTER (WHERE interest = '${k}') AS int_${k}_src,\n` +
  `    max(last_seen)             FILTER (WHERE interest = '${k}') AS int_${k}_at`
).join(',\n')

const sigSelect = keys.map(k => `  sg.int_${k}_src,  sg.int_${k}_at`).join(',\n')

const sql = `-- wa_045_customer_features.sql
-- ============================================================================
--  GENERATED FILE — do not edit by hand.
--  Produced by: node scripts/gen-feature-view.mjs
--  Interests (${keys.length}) read from lib/signals.ts: ${keys.join(', ')}
-- ============================================================================
--
--  ONE ROW PER PERSON, ONE COLUMN PER FEATURE.
--
--  Before this, every filter re-derived its answer from raw event tables and the
--  app intersected the lists in its own memory. That made cohort resolution slow,
--  limited it to AND (no OR, no NOT), and made exposing a new field expensive
--  enough that most were never exposed. This view is the single place that says
--  "here is everything we know about this person".
--
--  It is a VIEW, not a table: always live, nothing to refresh, nothing to go
--  stale. If it ever gets slow, it can become a materialised view with a
--  scheduled rebuild WITHOUT any caller changing.
--
--  INTERESTS carry their SOURCES rather than being a bare yes/no, because source
--  changes meaning: 'rate' from whatsapp is a person asking us for rates (a
--  subscription); 'rate' from a call is a salesman noting what came up. Same
--  interest, opposite consent. int_rate_src = {whatsapp} answers both "has rate
--  interest" (non-empty) and "from chat" (contains whatsapp) in one column,
--  instead of 5 columns per interest plus a roll-up.
--
--  Idempotent: safe to re-run.

-- Phone normaliser — matches tenDigit() in lib/reach/resolve.ts.
CREATE OR REPLACE FUNCTION mnap_ten_digit(raw TEXT) RETURNS TEXT AS $$
  SELECT CASE WHEN length(d) > 10 AND left(d, 2) = '91' THEN right(d, 10) ELSE d END
  FROM (SELECT regexp_replace(COALESCE(raw, ''), '\\D', '', 'g') AS d) s;
$$ LANGUAGE sql IMMUTABLE;

DROP VIEW IF EXISTS customer_features;

CREATE VIEW customer_features AS
WITH
-- ── Sales: who they are as a buyer (pipeline → wa_b_markers) ────────────────
sales AS (
  SELECT DISTINCT ON (mnap_ten_digit(c.phone))
    mnap_ten_digit(c.phone) AS phone,
    m.recency_tier, m.value_tier, m.rfm_segment, m.frequency_tier,
    m.primary_metal, m.is_high_value, m.is_likely_wedding,
    ('Lookalike Seed' = ANY(COALESCE(m.audience_labels, '{}'))) AS is_lookalike_seed,
    m.lifetime_value, m.total_bills, m.last_purchase_date,
    m.days_since_last_purchase, m.outreach_bucket, m.audience_labels
  FROM wa_b_customers c
  JOIN wa_b_markers m ON m.customer_id = c.id
  ORDER BY mnap_ten_digit(c.phone), m.imported_at DESC
),

-- ── Calls: counts + outcomes. Disconnects count success = FALSE only; a
--    PENDING log (success IS NULL, Call tapped, outcome not submitted) is not a
--    disconnect and must never retire anyone. Mirrors wa_044.
calls AS (
  SELECT mnap_ten_digit(c.phone) AS phone,
    count(*)                                        AS attempts,
    count(*) FILTER (WHERE l.success IS TRUE)       AS connected,
    count(*) FILTER (WHERE l.success IS FALSE)      AS disconnects,
    max(l.called_at)                                AS last_at,
    array_agg(DISTINCT l.intent) FILTER (WHERE l.intent IS NOT NULL) AS intents
  FROM wa_b_call_logs l
  JOIN wa_b_customers c ON c.id = l.customer_id
  GROUP BY 1
),
call_last AS (
  SELECT DISTINCT ON (mnap_ten_digit(c.phone))
    mnap_ten_digit(c.phone) AS phone, l.intent AS last_intent
  FROM wa_b_call_logs l
  JOIN wa_b_customers c ON c.id = l.customer_id
  WHERE l.intent IS NOT NULL
  ORDER BY mnap_ten_digit(c.phone), l.called_at DESC
),
call_topics AS (
  SELECT mnap_ten_digit(c.phone) AS phone, array_agg(DISTINCT t) AS topics
  FROM wa_b_call_logs l
  JOIN wa_b_customers c ON c.id = l.customer_id
  CROSS JOIN LATERAL unnest(COALESCE(l.topics, '{}')) AS t
  WHERE l.success IS TRUE
  GROUP BY 1
),
call_camps AS (
  SELECT mnap_ten_digit(c.phone) AS phone, array_agg(DISTINCT cc.name) AS campaigns
  FROM wa_b_call_tasks tk
  JOIN wa_b_customers c        ON c.id  = tk.customer_id
  JOIN wa_b_call_campaigns cc  ON cc.id = tk.campaign_id
  GROUP BY 1
),

-- ── The Type B row itself: hot star, DNC, disconnect budget, walk-in ────────
cust AS (
  SELECT DISTINCT ON (mnap_ten_digit(phone))
    mnap_ten_digit(phone) AS phone,
    is_hot_lead, is_do_not_call, failed_call_attempts,
    walkin_at, walkin_timing, walkin_salesman_id
  FROM wa_b_customers
  ORDER BY mnap_ten_digit(phone), walkin_at DESC NULLS LAST
),

-- ── Chat activity (inbound only — them talking to us) ───────────────────────
chat AS (
  SELECT mnap_ten_digit(t.phone) AS phone,
    count(*) AS inbound_count, max(m.created_at) AS last_inbound_at
  FROM wa_messages m
  JOIN wa_threads t ON t.id = m.thread_id
  WHERE m.direction = 'inbound'
  GROUP BY 1
),

-- ── Subscriptions: canonical topic KEYS (wa_033), not display names, so a
--    parent and child topic both roll up to the same key.
subs AS (
  SELECT mnap_ten_digit(cu.phone) AS phone,
    array_agg(DISTINCT tp.key) FILTER (WHERE tp.key IS NOT NULL) AS topics,
    min(ci.created_at) AS subscribed_at
  FROM wa_customer_interests ci
  JOIN wa_customers cu       ON cu.id = ci.customer_id
  JOIN wa_interest_topics tp ON tp.id = ci.topic_id
  GROUP BY 1
),

-- ── Ad leads (empty until ads are wired) ────────────────────────────────────
ads AS (
  SELECT mnap_ten_digit(phone) AS phone,
    TRUE AS is_lead,
    array_agg(DISTINCT ad_campaign) FILTER (WHERE ad_campaign IS NOT NULL) AS campaigns,
    min(first_seen) AS first_at
  FROM wa_ad_leads
  GROUP BY 1
),

-- ── Which channels we have heard from them on. Signals, plus a walk-in visit
--    and an ad lead as touches in their own right (a visit is a channel even if
--    nobody tagged an interest). Drives multi-source intent.
all_sources AS (
  SELECT mnap_ten_digit(phone) AS phone, source FROM wa_signals
  UNION
  SELECT mnap_ten_digit(phone), 'walkin' FROM wa_b_customers WHERE walkin_at IS NOT NULL
  UNION
  SELECT mnap_ten_digit(phone), 'ad'     FROM wa_ad_leads
),
src AS (
  SELECT phone, array_agg(DISTINCT source) AS sources, count(DISTINCT source) AS source_count
  FROM all_sources GROUP BY 1
),

-- ── The interest pivot: tall wa_signals → one pair of columns per interest ──
sig AS (
  SELECT mnap_ten_digit(phone) AS phone,
${sigAggregates}
  FROM wa_signals
  GROUP BY 1
)

SELECT
  -- ── identity ──
  mnap_ten_digit(ct.phone)                        AS phone,
  COALESCE(ct.name_override, ct.name)             AS name,
  ct.is_opted_out                                 AS is_opted_out,
  (s.phone IS NOT NULL)                           AS is_buyer,

  -- ── sales_ ──
  s.recency_tier                                  AS sales_recency_tier,
  s.value_tier                                    AS sales_value_tier,
  s.rfm_segment                                   AS sales_rfm_segment,
  s.frequency_tier                                AS sales_frequency_tier,
  s.primary_metal                                 AS sales_primary_metal,
  COALESCE(s.is_high_value, FALSE)                AS sales_is_high_value,
  COALESCE(s.is_likely_wedding, FALSE)            AS sales_is_likely_wedding,
  COALESCE(s.is_lookalike_seed, FALSE)            AS sales_is_lookalike_seed,
  s.lifetime_value                                AS sales_lifetime_value,
  s.total_bills                                   AS sales_total_bills,
  s.last_purchase_date                            AS sales_last_purchase_date,
  s.days_since_last_purchase                      AS sales_days_since_purchase,
  s.outreach_bucket                               AS sales_outreach_bucket,
  s.audience_labels                               AS sales_labels,

  -- ── call_ ──
  COALESCE(cl.attempts, 0)                        AS call_attempts,
  COALESCE(cl.connected, 0)                       AS call_connected,
  COALESCE(cu.failed_call_attempts, 0)            AS call_disconnects,
  cl.last_at                                      AS call_last_at,
  clast.last_intent                               AS call_last_intent,
  cl.intents                                      AS call_intents,
  ctop.topics                                     AS call_topics,
  COALESCE(cu.is_hot_lead, FALSE)                 AS call_is_hot,
  COALESCE(cu.is_do_not_call, FALSE)              AS call_dnc,
  ccamp.campaigns                                 AS call_campaigns,

  -- ── chat_ ──
  ch.last_inbound_at                              AS chat_last_inbound_at,
  COALESCE(ch.inbound_count, 0)                   AS chat_inbound_count,
  sb.topics                                       AS chat_subscribed_topics,
  sb.subscribed_at                                AS chat_subscribed_at,

  -- ── walkin_ ──
  cu.walkin_at                                    AS walkin_last_at,
  cu.walkin_timing                                AS walkin_timing,
  sm.alias                                        AS walkin_salesman,
  -- The one PRECOMPUTED feature: it compares two of the person's own fields
  -- (last purchase vs visit date), which a field-to-value filter cannot express.
  (cu.walkin_at IS NOT NULL
    AND (s.last_purchase_date IS NULL OR s.last_purchase_date < cu.walkin_at::date))
                                                  AS walkin_no_purchase,

  -- ── ad_ ──
  COALESCE(ad.is_lead, FALSE)                     AS ad_is_lead,
  ad.campaigns                                    AS ad_campaigns,
  ad.first_at                                     AS ad_first_at,

  -- ── cross-source ──
  COALESCE(sr.sources, '{}')                      AS sources,
  COALESCE(sr.source_count, 0)                    AS source_count,

  -- ── int_<interest>_src / _at ──
${sigSelect}

FROM contacts ct
LEFT JOIN sales       s     ON s.phone     = mnap_ten_digit(ct.phone)
LEFT JOIN calls       cl    ON cl.phone    = mnap_ten_digit(ct.phone)
LEFT JOIN call_last   clast ON clast.phone = mnap_ten_digit(ct.phone)
LEFT JOIN call_topics ctop  ON ctop.phone  = mnap_ten_digit(ct.phone)
LEFT JOIN call_camps  ccamp ON ccamp.phone = mnap_ten_digit(ct.phone)
LEFT JOIN cust        cu    ON cu.phone    = mnap_ten_digit(ct.phone)
LEFT JOIN chat        ch    ON ch.phone    = mnap_ten_digit(ct.phone)
LEFT JOIN subs        sb    ON sb.phone    = mnap_ten_digit(ct.phone)
LEFT JOIN ads         ad    ON ad.phone    = mnap_ten_digit(ct.phone)
LEFT JOIN src         sr    ON sr.phone    = mnap_ten_digit(ct.phone)
LEFT JOIN sig         sg    ON sg.phone    = mnap_ten_digit(ct.phone)
LEFT JOIN salesmen    sm    ON sm.id       = cu.walkin_salesman_id;

COMMENT ON VIEW customer_features IS
  'One row per person, one column per feature. Generated by scripts/gen-feature-view.mjs from lib/signals.ts — do not edit the migration by hand. An audience is a WHERE clause over this view.';

GRANT SELECT ON customer_features TO authenticated, service_role;
`

const out = join(root, 'supabase', 'migrations', 'wa_045_customer_features.sql')
writeFileSync(out, sql, 'utf8')
console.log(`Wrote ${out}`)
console.log(`  ${keys.length} interests → ${keys.length * 2} int_ columns`)
console.log(`  ${keys.join(', ')}`)
