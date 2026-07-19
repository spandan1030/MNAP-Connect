// RULE-ENGINE CHECK.
//
// Two halves:
//   1. EQUIVALENCE — express a preset audience as a rule tree and prove it
//      returns the same people as the legacy filter for that preset. This is
//      the real gate: the new grammar must not quietly mean something else.
//   2. ALGEBRA — the capabilities that have no legacy oracle (OR across groups,
//      NOT on a rule) are checked against laws that must hold no matter what
//      the data says: A OR B >= max(A,B), A AND NOT B <= A, and
//      |A AND B| + |A AND NOT B| = |A|.
//
//   npx tsc -p tsconfig.parity.json && node scripts/_fix-aliases.mjs
//   node --env-file=.env.local scripts/rules-check.mjs
//
// Read-only.

import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

const { resolveCohortPhones } = require('../.parity-build/lib/reach/resolve.js')
const { resolveRuleTree } = require('../.parity-build/lib/audiences/resolve-rules.js')
const { describeTree } = require('../.parity-build/lib/audiences/rules.js')

const one = rules => ({ groups: [{ rules }] })

// Preset ⇄ rule-tree pairs that must agree.
const EQUIV = [
  { name: 'A1 Lapsed high-value',
    filter: { recency_tier: ['Lapsed'], value_tier: ['VIP', 'High'] },
    tree: one([
      { field: 'sales_recency_tier', op: 'any_of', values: ['Lapsed'] },
      { field: 'sales_value_tier', op: 'any_of', values: ['VIP', 'High'] }]) },
  { name: 'A4 At-risk',
    filter: { rfm_segment: ['At-Risk'] },
    tree: one([{ field: 'sales_rfm_segment', op: 'any_of', values: ['At-Risk'] }]) },
  { name: 'A5 Call-unresponsive',
    filter: { callUnresponsive: true },
    tree: one([
      { field: 'call_attempts', op: 'gte', min: 3 },
      { field: 'call_connected', op: 'lte', max: 0 }]) },
  { name: 'B2 Hot-starred',
    filter: { hotLead: true },
    tree: one([{ field: 'call_is_hot', op: 'is_true' }]) },
  { name: 'B3 Multi-source',
    filter: { multiSource: true },
    tree: one([{ field: 'source_count', op: 'gte', min: 2 }]) },
  { name: 'C1 Rate from chat',
    filter: { interests: ['rate'], interestSources: ['whatsapp'] },
    tree: one([{ field: 'interest', op: 'any_of', values: ['rate'], sources: ['whatsapp'] }]) },
  { name: 'C4 Designs OR offers',
    filter: { interests: ['designs', 'offers'] },
    tree: one([{ field: 'interest', op: 'any_of', values: ['designs', 'offers'] }]) },
  { name: 'D1 High value',
    filter: { is_high_value: true },
    tree: one([{ field: 'sales_is_high_value', op: 'is_true' }]) },
  { name: 'E1 Champions/Loyal',
    filter: { rfm_segment: ['Champion', 'Loyal'] },
    tree: one([{ field: 'sales_rfm_segment', op: 'any_of', values: ['Champion', 'Loyal'] }]) },
  { name: 'E3 Chat non-buyers',
    filter: { chatNonBuyer: true },
    tree: one([
      { field: 'signal_sources', op: 'any_of', values: ['whatsapp'] },
      { field: 'is_buyer', op: 'is_true', not: true }]) },
  { name: 'Walk-in, not bought since',
    filter: { walkinNoPurchase: true },
    tree: one([{ field: 'walkin_no_purchase', op: 'is_true' }]) },
]

const size = async tree => (await resolveRuleTree(tree)).phones.size

let fails = 0
console.log(`\nRULE ENGINE CHECK\n${'='.repeat(72)}`)
console.log('1. EQUIVALENCE — rule tree must equal the legacy filter\n')

for (const c of EQUIV) {
  const legacy = await resolveCohortPhones(c.filter)
  const ruled = await resolveRuleTree(c.tree)
  if (ruled.error) { console.log(`  FAIL  ${c.name} -> ${ruled.error}`); fails++; continue }
  const L = legacy.phones, R = ruled.phones
  const missing = [...L].filter(p => !R.has(p)).length
  const extra = [...R].filter(p => !L.has(p)).length
  const ok = missing === 0 && extra === 0
  if (!ok) fails++
  console.log(`  ${ok ? 'MATCH' : 'DIFF '}  ${c.name.padEnd(26)} legacy ${String(L.size).padStart(5)} | rules ${String(R.size).padStart(5)}${ok ? '' : `  (-${missing} +${extra})`}`)
  if (!ok) console.log(`         tree: ${describeTree(c.tree)}`)
}

console.log('\n2. ALGEBRA — OR / NOT, which have no legacy equivalent\n')

const A = { field: 'sales_recency_tier', op: 'any_of', values: ['Lapsed'] }
const B = { field: 'sales_is_high_value', op: 'is_true' }

const nA = await size(one([A]))
const nB = await size(one([B]))
const nAorB = await size({ groups: [{ rules: [A] }, { rules: [B] }] })
const nAandB = await size(one([A, B]))
const nAnotB = await size(one([A, { ...B, not: true }]))

console.log(`  A  = ${describeTree(one([A]))}  -> ${nA}`)
console.log(`  B  = ${describeTree(one([B]))}  -> ${nB}`)
console.log(`  A OR B      -> ${nAorB}`)
console.log(`  A AND B     -> ${nAandB}`)
console.log(`  A AND NOT B -> ${nAnotB}`)

const laws = [
  ['A OR B >= max(A,B)', nAorB >= Math.max(nA, nB)],
  ['A OR B <= A + B', nAorB <= nA + nB],
  ['A OR B = A + B - (A AND B)', nAorB === nA + nB - nAandB],
  ['A AND NOT B <= A', nAnotB <= nA],
  ['(A AND B) + (A AND NOT B) = A', nAandB + nAnotB === nA],
]
console.log('')
for (const [label, holds] of laws) {
  console.log(`  ${holds ? 'OK  ' : 'FAIL'}  ${label}`)
  if (!holds) fails++
}

console.log(`\n${'='.repeat(72)}`)
console.log(fails === 0
  ? 'RULE ENGINE CLEAN — grammar agrees with the old filters, and OR/NOT behave.\n'
  : `${fails} problem(s) — do not ship until explained.\n`)
process.exit(fails === 0 ? 0 : 1)
