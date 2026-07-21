// CHIPS → TREE CHECK.
//
// Every chip filter must resolve to the SAME people through the converter
// (chipsToTree -> resolveRuleTree) as through the legacy resolver
// (resolveCohortPhones). This is the gate for retiring the second grammar:
// the two faces must be one engine.
//
//   npx tsc -p tsconfig.parity.json && node scripts/_fix-aliases.mjs
//   node --env-file=.env.local scripts/chips-check.mjs
//
// Read-only.

import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { resolveCohortPhones } = require('../.parity-build/lib/reach/resolve.js')
const { resolveRuleTree } = require('../.parity-build/lib/audiences/resolve-rules.js')
const { chipsToTree, chipsConvertible } = require('../.parity-build/lib/audiences/chips-to-tree.js')
const { describeTree } = require('../.parity-build/lib/audiences/rules.js')

// Every preset filter, plus a few hand-built ones exercising the date/interval
// and behaviour paths the presets don't reach.
const CASES = [
  ['A1 lapsed high-value', { recency_tier: ['Lapsed'], value_tier: ['VIP','High'] }],
  ['A4 at-risk', { rfm_segment: ['At-Risk'] }],
  ['A5 unresponsive', { callUnresponsive: true }],
  ['B1 walk-in no purchase', { walkinNoPurchase: true }],
  ['B2 hot', { hotLead: true }],
  ['B3 multi-source', { multiSource: true }],
  ['B4 buying-soon', { walkinTiming: ['within_7d','within_1m'] }],
  ['C1 daily-rate', { interests: ['rate'], interestSources: ['whatsapp'] }],
  ['C2 wedding', { interests: ['wedding'] }],
  ['C4 designs/offers', { interests: ['designs','offers'] }],
  ['E3 chat non-buyer', { chatNonBuyer: true }],
  ['D1 high-value', { is_high_value: true }],
  ['AD1 ad lead', { adLead: true }],
  // extra shapes
  ['high value AND wedding', { is_high_value: true, is_likely_wedding: true }],
  ['lifetime >= 50k', { min_lifetime_value: 50000 }],
  ['bills >= 3', { min_total_bills: 3 }],
  ['metal gold', { primary_metal: ['gold'] }],
  ['called last 60d', { calledFrom: new Date(Date.now()-60*864e5).toLocaleDateString('en-CA') }],
  ['messaged, wide', { messagedFrom: '2020-01-01' }],
  ['rate seen since Jan', { interests: ['rate'], interestFrom: '2026-01-01' }],
  ['intent+topic same call', { intents: ['will_come'], callTopics: ['rate'] }],
  ['sources only (chat)', { interestSources: ['whatsapp'] }],
  ['recency AND interest AND walk-in', { recency_tier: ['Lapsed'], interests: ['wedding'], walkedIn: true }],
]

let fail = 0
for (const [name, filter] of CASES) {
  if (!chipsConvertible(filter)) { console.log(`  SKIP ${name} (not convertible)`); continue }
  const tree = chipsToTree(filter)
  const [a, b] = await Promise.all([resolveCohortPhones(filter), resolveRuleTree(tree)])
  if (a.error || b.error) { console.log(`  ERR  ${name}: ${a.error ?? ''} ${b.error ?? ''}`); fail++; continue }
  const A = a.phones, B = b.phones
  const onlyA = [...A].filter(p => !B.has(p)).length
  const onlyB = [...B].filter(p => !A.has(p)).length
  const ok = onlyA === 0 && onlyB === 0
  if (!ok) fail++
  console.log(`  ${ok?'OK  ':'FAIL'} ${name.padEnd(30)} chips=${A.size} tree=${B.size}` +
    (ok?'':`  onlyChips=${onlyA} onlyTree=${onlyB}  [${describeTree(tree)}]`))
}
console.log(`\n${fail===0 ? 'CHIPS ENGINE CLEAN — both faces resolve identically' : `${fail} FAILURE(S)`}`)
process.exit(fail===0?0:1)
