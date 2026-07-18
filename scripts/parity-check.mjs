// PARITY GATE for the view-backed resolver.
//
// Runs every preset audience through BOTH resolvers against the real database
// and compares the resulting phone sets member-by-member:
//
//   resolveCohortPhonesLegacy — derives each family from the raw event tables
//   resolveCohortPhones       — the wa_046 customer_features view
//
// The point is to prove the view says the same thing about the same people
// before anything switches over. Comparing the ACTUAL exported functions (not a
// re-implementation) is what makes this meaningful, hence the compile step.
//
//   npx tsc -p tsconfig.parity.json
//   node scripts/_fix-aliases.mjs
//   node --env-file=.env.local scripts/parity-check.mjs
//
// Read-only: it issues SELECTs and nothing else.

import { createRequire } from 'node:module'
import { createClient } from '@supabase/supabase-js'
const require = createRequire(import.meta.url)

const { resolveCohortPhones, resolveCohortPhonesLegacy } = require('../.parity-build/lib/reach/resolve.js')
const { AUDIENCE_CATALOGUE } = require('../.parity-build/lib/audiences/catalogue.js')

// ── Preflight ───────────────────────────────────────────────────────────────
// resolveCohortPhones falls back to the legacy path when the view is missing or
// behind. That fallback is right for production and POISON for a parity gate:
// both sides then run the same code and every case "matches". An earlier run of
// this script reported CLEAN while four cases were silently on the legacy path.
// So: verify the columns up front, and treat any fallback during the run as a
// failure, not a match.
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const REQUIRED = ['phone', 'sources', 'source_count', 'signal_sources', 'signal_source_count',
  'call_campaign_ids', 'walkin_no_purchase', 'is_buyer', 'int_rate_src']
const missing = []
for (const col of REQUIRED) {
  const { error } = await sb.from('customer_features').select(col).limit(1)
  if (error) missing.push(col)
}
if (missing.length) {
  console.error(`\nABORT — customer_features is missing: ${missing.join(', ')}`)
  console.error('Apply supabase/migrations/wa_046_customer_features.sql, then re-run.\n')
  process.exit(2)
}
console.log('preflight: customer_features has all required columns')

// Trip a flag if the resolver logs its fallback warning mid-case.
let fellBack = false
const realWarn = console.warn
console.warn = (...args) => {
  if (String(args[0]).includes('[resolve]')) fellBack = true
  realWarn(...args)
}

// A few hand-written cases beyond the catalogue, aimed squarely at the paths
// that did NOT move to the view — they must be unchanged.
const EXTRA_CASES = [
  { key: 'X-called-window',  name: 'Called in a date window',        filter: { calledFrom: '2026-01-01', calledTo: '2026-07-18' } },
  { key: 'X-intent+topic',   name: 'Intent AND topic (same call)',   filter: { intents: ['will_come'], callTopics: ['rate'] } },
  { key: 'X-signal-window',  name: 'Signal seen in a window',        filter: { interests: ['rate'], interestFrom: '2026-01-01' } },
  { key: 'X-messaged',       name: 'Messaged us in a window',        filter: { messagedFrom: '2026-06-01' } },
  { key: 'X-src-only',       name: 'Source facet with no interest',  filter: { interestSources: ['whatsapp'] } },
  { key: 'X-combo',          name: 'Lapsed VIP who walked in',       filter: { recency_tier: ['Lapsed'], value_tier: ['VIP'], walkedIn: true } },
  { key: 'X-metal',          name: 'Primary metal = gold',           filter: { primary_metal: ['gold'] } },
  { key: 'X-ltv',            name: 'Lifetime value >= 100000',       filter: { min_lifetime_value: 100000 } },
]

const cases = [
  ...AUDIENCE_CATALOGUE.map(a => ({ key: a.key, name: a.name, filter: a.filter })),
  ...EXTRA_CASES,
]

const pad = (s, n) => String(s).padEnd(n)
const num = (s, n) => String(s).padStart(n)

let mismatches = 0
let failures = 0
const started = Date.now()

console.log(`\nPARITY CHECK — ${cases.length} cases\n${'='.repeat(78)}`)
console.log(`${pad('case', 6)}${pad('name', 30)}${num('legacy', 8)}${num('view', 8)}${num('diff', 7)}  verdict`)
console.log('-'.repeat(78))

for (const c of cases) {
  let legacy, view, tLegacy, tView
  fellBack = false
  try {
    let t0 = Date.now()
    legacy = await resolveCohortPhonesLegacy(c.filter)
    tLegacy = Date.now() - t0
    t0 = Date.now()
    view = await resolveCohortPhones(c.filter)
    tView = Date.now() - t0
  } catch (e) {
    console.log(`${pad(c.key, 6)}${pad(c.name.slice(0, 29), 30)}${num('-', 8)}${num('-', 8)}${num('-', 7)}  THREW: ${e.message}`)
    failures++
    continue
  }

  if (view.error && !legacy.error) {
    console.log(`${pad(c.key, 6)}${pad(c.name.slice(0, 29), 30)}${num(legacy.phones.size, 8)}${num('err', 8)}${num('-', 7)}  VIEW ERROR: ${view.error}`)
    failures++
    continue
  }

  if (fellBack) {
    console.log(`${pad(c.key, 6)}${pad(c.name.slice(0, 29), 30)}${num(legacy.phones.size, 8)}${num('-', 8)}${num('-', 7)}  FELL BACK TO LEGACY — not a real comparison`)
    failures++
    continue
  }

  const L = legacy.phones, V = view.phones
  const onlyLegacy = [...L].filter(p => !V.has(p))
  const onlyView = [...V].filter(p => !L.has(p))
  const same = onlyLegacy.length === 0 && onlyView.length === 0
  if (!same) mismatches++

  const verdict = same ? `MATCH  (${tLegacy}ms -> ${tView}ms)` : `DIFF  -${onlyLegacy.length} +${onlyView.length}`
  console.log(`${pad(c.key, 6)}${pad(c.name.slice(0, 29), 30)}${num(L.size, 8)}${num(V.size, 8)}${num(V.size - L.size, 7)}  ${verdict}`)

  if (!same) {
    if (onlyLegacy.length) console.log(`        only in legacy (${onlyLegacy.length}): ${onlyLegacy.slice(0, 5).join(', ')}${onlyLegacy.length > 5 ? ' …' : ''}`)
    if (onlyView.length) console.log(`        only in view   (${onlyView.length}): ${onlyView.slice(0, 5).join(', ')}${onlyView.length > 5 ? ' …' : ''}`)
  }
}

console.log('-'.repeat(78))
console.log(`${cases.length} cases · ${mismatches} mismatch(es) · ${failures} failure(s) · ${((Date.now() - started) / 1000).toFixed(1)}s`)
console.log(mismatches === 0 && failures === 0
  ? '\nPARITY CLEAN — the view returns exactly the same people. Safe to switch.\n'
  : '\nNOT CLEAN — do not switch until every difference above is explained.\n')

process.exit(mismatches === 0 && failures === 0 ? 0 : 1)
