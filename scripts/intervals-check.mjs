// INTERVAL CHECK — proves the event-window half of the grammar.
//
// Intervals have a legacy oracle: the Reach chips already answer
// "called between" / "messaged between" / "signal seen between" by querying the
// same logs. So an interval MUST return the same people as the equivalent chip.
// NOT has no oracle, so it is checked against laws that must hold on any data.
//
//   npx tsc -p tsconfig.parity.json && node scripts/_fix-aliases.mjs
//   node --env-file=.env.local scripts/intervals-check.mjs
//
// Read-only.

import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

const { resolveCohortPhones } = require('../.parity-build/lib/reach/resolve.js')
const { resolveRuleTree } = require('../.parity-build/lib/audiences/resolve-rules.js')
const { describeTree } = require('../.parity-build/lib/audiences/rules.js')

const tree = (groups, intervals) => ({ groups, intervals })
const noRules = intervals => tree([{ rules: [] }], intervals)

const ago = d => { const x = new Date(); x.setDate(x.getDate() - d); return x.toLocaleDateString('en-CA') }
const WIDE_FROM = '2020-01-01', WIDE_TO = new Date().toLocaleDateString('en-CA')

// ── 1. EQUIVALENCE against the chips ───────────────────────────────────────
const EQUIV = [
  { name: 'called in a wide window',
    filter: { calledFrom: WIDE_FROM, calledTo: WIDE_TO },
    t: noRules([{ dataset: 'calls', from: WIDE_FROM, to: WIDE_TO }]) },
  { name: 'called, last 30d',
    filter: { calledFrom: ago(30), calledTo: WIDE_TO },
    t: noRules([{ dataset: 'calls', from: ago(30), to: WIDE_TO }]) },
  { name: 'messaged us, wide',
    filter: { messagedFrom: WIDE_FROM, messagedTo: WIDE_TO },
    t: noRules([{ dataset: 'messages', from: WIDE_FROM, to: WIDE_TO }]) },
  { name: 'signal seen, wide',
    filter: { interestFrom: WIDE_FROM, interestTo: WIDE_TO },
    t: noRules([{ dataset: 'signals', from: WIDE_FROM, to: WIDE_TO }]) },
  { name: 'rate signal from chat, wide',
    filter: { interests: ['rate'], interestSources: ['whatsapp'], interestFrom: WIDE_FROM, interestTo: WIDE_TO },
    t: noRules([{ dataset: 'signals', interests: ['rate'], sources: ['whatsapp'], from: WIDE_FROM, to: WIDE_TO }]) },
  { name: 'called about rate, wide',
    filter: { callTopics: ['rate'], calledFrom: WIDE_FROM, calledTo: WIDE_TO },
    t: noRules([{ dataset: 'calls', topics: ['rate'], from: WIDE_FROM, to: WIDE_TO }]) },
]

let fail = 0
console.log('EQUIVALENCE — interval vs the chip that already answers it\n')
for (const c of EQUIV) {
  const [a, b] = await Promise.all([
    resolveCohortPhones(c.filter),
    resolveRuleTree(c.t),
  ])
  if (a.error || b.error) { console.log(`  ERROR ${c.name}: ${a.error ?? ''} ${b.error ?? ''}`); fail++; continue }
  const A = a.phones, B = b.phones
  const onlyA = [...A].filter(p => !B.has(p))
  const onlyB = [...B].filter(p => !A.has(p))
  const ok = onlyA.length === 0 && onlyB.length === 0
  if (!ok) fail++
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${c.name.padEnd(32)} chips=${A.size} interval=${B.size}` +
    (ok ? '' : `  onlyChips=${onlyA.length} onlyInterval=${onlyB.length}`))
}

// ── 2. LAWS for NOT and for AND-with-rules ─────────────────────────────────
console.log('\nLAWS — NOT and rules+interval have no legacy oracle\n')
const RULES = { groups: [{ rules: [{ field: 'sales_recency_tier', op: 'any_of', values: ['Lapsed'] }] }] }
const IV = { dataset: 'calls', from: WIDE_FROM, to: WIDE_TO }

const [base, withIv, withNot, ivAlone] = await Promise.all([
  resolveRuleTree({ ...RULES, intervals: [] }),
  resolveRuleTree({ ...RULES, intervals: [IV] }),
  resolveRuleTree({ ...RULES, intervals: [{ ...IV, not: true }] }),
  resolveRuleTree(noRules([IV])),
])
const n = r => r.phones.size
console.log(`  rules only                    : ${n(base)}`)
console.log(`  rules AND called              : ${n(withIv)}`)
console.log(`  rules AND NOT called          : ${n(withNot)}`)
console.log(`  interval alone                : ${n(ivAlone)}`)

const laws = [
  ['(rules AND iv) + (rules AND NOT iv) = rules', n(withIv) + n(withNot) === n(base)],
  ['rules AND iv <= rules',                       n(withIv) <= n(base)],
  ['rules AND iv <= interval alone',              n(withIv) <= n(ivAlone)],
  ['rules AND NOT iv <= rules',                   n(withNot) <= n(base)],
]
for (const [label, ok] of laws) { if (!ok) fail++; console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}`) }

// ── 3. Relative vs absolute windows agree ──────────────────────────────────
const [rel, abs] = await Promise.all([
  resolveRuleTree(noRules([{ dataset: 'calls', days: 30 }])),
  resolveRuleTree(noRules([{ dataset: 'calls', from: ago(30) }])),
])
const relOk = rel.phones.size === abs.phones.size
if (!relOk) fail++
console.log(`\n  ${relOk ? 'OK  ' : 'FAIL'} "last 30 days" = "on/after ${ago(30)}"   ${rel.phones.size} vs ${abs.phones.size}`)

console.log(`\n${fail === 0 ? 'INTERVALS CLEAN' : `${fail} FAILURE(S)`}`)
console.log('sample description:', describeTree({ ...RULES, intervals: [{ ...IV, not: true }] }))
process.exit(fail === 0 ? 0 : 1)
