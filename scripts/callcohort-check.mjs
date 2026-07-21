// CALL COHORT CHECK — the live call path changed its data source (markers table
// -> feature view). Prove the CALLABLE set is unchanged for real filters before
// trusting it.
//
//   OLD: wa_b_customers INNER wa_b_markers, marker filters, + interest intersect,
//        then the call gates (do_not_call, <4 disconnects, snooze).
//   NEW: chipsToTree -> resolveRuleTree (customer_features) -> callableTypeB.
//
//   npx tsc -p tsconfig.parity.json && node scripts/_fix-aliases.mjs
//   node --env-file=.env.local scripts/callcohort-check.mjs
//
// Read-only.
import { createRequire } from 'node:module'
import { createClient } from '@supabase/supabase-js'
const require = createRequire(import.meta.url)
const { resolveRuleTree } = require('../.parity-build/lib/audiences/resolve-rules.js')
const { chipsToTree } = require('../.parity-build/lib/audiences/chips-to-tree.js')

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const ten = p => { const d=(p??'').replace(/\D/g,''); return d.length>10&&d.startsWith('91')?d.slice(-10):d }
const today = new Date().toLocaleDateString('en-CA')

// OLD callable ids, reconstructed exactly.
async function oldCallable(f) {
  const rows = []
  for (let from=0;;from+=1000){
    let q = sb.from('wa_b_customers')
      .select('id, phone, wa_b_markers!inner(customer_id)')
      .eq('is_do_not_call', false)
      .lt('failed_call_attempts', 4)
      .or(`call_snooze_until.is.null,call_snooze_until.lte.${today}`)
    if (f.recency_tier) q=q.in('wa_b_markers.recency_tier', f.recency_tier)
    if (f.value_tier) q=q.in('wa_b_markers.value_tier', f.value_tier)
    if (f.rfm_segment) q=q.in('wa_b_markers.rfm_segment', f.rfm_segment)
    if (f.primary_metal) q=q.in('wa_b_markers.primary_metal', f.primary_metal)
    if (f.is_high_value) q=q.eq('wa_b_markers.is_high_value', true)
    if (f.is_likely_wedding) q=q.eq('wa_b_markers.is_likely_wedding', true)
    if (f.min_lifetime_value!=null) q=q.gte('wa_b_markers.lifetime_value', f.min_lifetime_value)
    if (f.min_total_bills!=null) q=q.gte('wa_b_markers.total_bills', f.min_total_bills)
    const { data, error } = await q.range(from, from+999)
    if (error) throw new Error(error.message)
    const page = data??[]; rows.push(...page); if(page.length<1000)break
  }
  let ids = rows
  if (f.interests) {
    const ph = new Set()
    for(let from=0;;from+=1000){ const {data}=await sb.from('wa_signals').select('phone').in('interest',f.interests).range(from,from+999)
      const r=data??[]; r.forEach(x=>ph.add(ten(x.phone))); if(r.length<1000)break }
    ids = rows.filter(r=>ph.has(ten(r.phone)))
  }
  return new Set(ids.map(r=>r.id))
}

async function callableTypeB(phones){
  const want=new Set([...phones].map(ten)); const ids=new Map()
  for(let from=0;;from+=1000){ const {data}=await sb.from('wa_b_customers')
    .select('id, phone, is_do_not_call, failed_call_attempts, call_snooze_until').range(from,from+999)
    const rows=data??[]
    for(const r of rows){ const p=ten(r.phone)
      if(!want.has(p)||ids.has(p)||r.is_do_not_call) continue
      if((r.failed_call_attempts??0)>=4) continue
      if(r.call_snooze_until && r.call_snooze_until>today) continue
      ids.set(p,r.id) }
    if(rows.length<1000)break }
  return [...ids.values()]
}
async function newCallable(f) {
  const { phones, error } = await resolveRuleTree(chipsToTree(f))
  if (error) throw new Error(error)
  return new Set(await callableTypeB(phones))
}

const CASES = [
  ['lapsed high-value', { recency_tier:['Lapsed'], value_tier:['VIP','High'] }],
  ['at-risk', { rfm_segment:['At-Risk'] }],
  ['high value', { is_high_value:true }],
  ['wedding', { is_likely_wedding:true }],
  ['gold metal', { primary_metal:['gold'] }],
  ['ltv>=50k', { min_lifetime_value:50000 }],
  ['bills>=3', { min_total_bills:3 }],
  ['lapsed + rate interest', { recency_tier:['Lapsed'], interests:['rate'] }],
]
let fail=0
for (const [name,f] of CASES) {
  const [O,N] = await Promise.all([oldCallable(f), newCallable(f)])
  const onlyO=[...O].filter(x=>!N.has(x)).length
  const onlyN=[...N].filter(x=>!O.has(x)).length
  const ok = onlyO===0 && onlyN===0
  if(!ok) fail++
  console.log(`  ${ok?'OK  ':'DIFF'} ${name.padEnd(24)} old=${O.size} new=${N.size}`+(ok?'':`  onlyOld=${onlyO} onlyNew=${onlyN}`))
}
console.log(`\n${fail===0?'CALL COHORT CLEAN — live call path resolves the same callable set':`${fail} DIFFERENCE(S) — review before trusting`}`)
process.exit(fail===0?0:1)
