// SERVER ONLY. Runs the interval queries against the event logs.
//
// SPLIT FROM intervals.ts DELIBERATELY: that file is imported by the rule
// builder, which is a client component. This one imports the service-role
// Supabase client, and pulling that into a browser bundle crashes the page
// (the key is not NEXT_PUBLIC, so it arrives undefined). Types, DATASETS and
// the date maths live in intervals.ts and are safe for either side; anything
// touching the database lives here.

import { supabaseAdmin } from '@/lib/supabase/admin'
import { tenDigit } from '@/lib/reach/resolve'
import { INTEREST_KEYS } from '@/lib/signals'
import { windowOf, type Interval } from './intervals'

const SOURCES = new Set(['sales', 'whatsapp', 'call', 'walkin', 'billing', 'ad'])
const INTENTS = new Set(['will_come', 'not_sure', 'wont_come', 'dont_call'])
const TOPICS = new Set(['rate', 'designs', 'offers', 'booking'])
const INTERESTS = new Set<string>(INTEREST_KEYS)

// ── Resolving one interval to the set of phones it matches ──────────────────
// Each returns the phones for which the event DID happen; `not` is applied by
// the caller, which subtracts rather than intersects.

async function callPhones(iv: Interval, w: { start: string | null; end: string | null }) {
  const ids = new Set<string>()
  for (let from = 0; ; from += 1000) {
    let q = supabaseAdmin.from('wa_b_call_logs').select('customer_id')
    const intents = (iv.intents ?? []).filter(v => INTENTS.has(v))
    const topics = (iv.topics ?? []).filter(v => TOPICS.has(v))
    if (intents.length) q = q.in('intent', intents)
    if (topics.length) q = q.overlaps('topics', topics)
    if (w.start) q = q.gte('called_at', w.start)
    if (w.end) q = q.lt('called_at', w.end)
    const { data, error } = await q.range(from, from + 999)
    if (error) throw new Error(`calls: ${error.message}`)
    const rows = (data ?? []) as { customer_id: string }[]
    for (const r of rows) if (r.customer_id) ids.add(r.customer_id)
    if (rows.length < 1000) break
  }
  const phones = new Set<string>()
  const list = [...ids]
  for (let i = 0; i < list.length; i += 300) {
    const { data } = await supabaseAdmin.from('wa_b_customers').select('phone').in('id', list.slice(i, i + 300))
    for (const r of (data ?? []) as { phone: string }[]) phones.add(tenDigit(r.phone))
  }
  return phones
}

async function messagePhones(w: { start: string | null; end: string | null }) {
  const threadIds = new Set<string>()
  for (let from = 0; ; from += 1000) {
    let q = supabaseAdmin.from('wa_messages').select('thread_id').eq('direction', 'inbound')
    if (w.start) q = q.gte('created_at', w.start)
    if (w.end) q = q.lt('created_at', w.end)
    const { data, error } = await q.range(from, from + 999)
    if (error) throw new Error(`messages: ${error.message}`)
    const rows = (data ?? []) as { thread_id: string }[]
    for (const r of rows) threadIds.add(r.thread_id)
    if (rows.length < 1000) break
  }
  const phones = new Set<string>()
  const list = [...threadIds]
  for (let i = 0; i < list.length; i += 300) {
    const { data } = await supabaseAdmin.from('wa_threads').select('phone').in('id', list.slice(i, i + 300))
    for (const r of (data ?? []) as { phone: string }[]) phones.add(tenDigit(r.phone))
  }
  return phones
}

async function signalPhones(iv: Interval, w: { start: string | null; end: string | null }) {
  const phones = new Set<string>()
  for (let from = 0; ; from += 1000) {
    let q = supabaseAdmin.from('wa_signals').select('phone')
    const interests = (iv.interests ?? []).filter(v => INTERESTS.has(v))
    const sources = (iv.sources ?? []).filter(v => SOURCES.has(v))
    if (interests.length) q = q.in('interest', interests)
    if (sources.length) q = q.in('source', sources)
    if (w.start) q = q.gte('last_seen', w.start)
    if (w.end) q = q.lt('last_seen', w.end)
    const { data, error } = await q.range(from, from + 999)
    if (error) throw new Error(`signals: ${error.message}`)
    const rows = (data ?? []) as { phone: string }[]
    for (const r of rows) phones.add(tenDigit(r.phone))
    if (rows.length < 1000) break
  }
  return phones
}

async function walkinPhones(w: { start: string | null; end: string | null }) {
  const phones = new Set<string>()
  for (let from = 0; ; from += 1000) {
    let q = supabaseAdmin.from('wa_walkin_visits').select('phone')
    if (w.start) q = q.gte('visited_at', w.start)
    if (w.end) q = q.lt('visited_at', w.end)
    const { data, error } = await q.range(from, from + 999)
    if (error) throw new Error(`walkins: ${error.message}`)
    const rows = (data ?? []) as { phone: string }[]
    for (const r of rows) phones.add(tenDigit(r.phone))
    if (rows.length < 1000) break
  }
  return phones
}

/** Phones for which this interval's event DID occur. Ignores `not`. */
export async function intervalPhones(iv: Interval): Promise<Set<string>> {
  const w = windowOf(iv)
  if (!w) return new Set()
  switch (iv.dataset) {
    case 'calls':    return callPhones(iv, w)
    case 'messages': return messagePhones(w)
    case 'signals':  return signalPhones(iv, w)
    case 'walkins':  return walkinPhones(w)
    default:         return new Set()
  }
}

/** True when this interval is complete enough to mean anything. */
