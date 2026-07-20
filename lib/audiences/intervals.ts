import { supabaseAdmin } from '@/lib/supabase/admin'
import { tenDigit } from '@/lib/reach/resolve'
import { INTEREST_KEYS } from '@/lib/signals'

// ═══════════════════════════════════════════════════════════════════════════
//  INTERVALS — "did this EVENT happen inside this window?"
//
//  Rules ask about a PERSON, using the one-row-per-customer view. Intervals ask
//  about an EVENT, using the log that event lives in. They are different
//  questions and deliberately stay different mechanisms:
//
//      cohort = (rule groups, OR'd)  AND  (every interval)
//
//  WHY NOT JUST A DATE RULE: the customer row remembers only the MOST RECENT of
//  each thing. "Last called between March" and "called at all during March" are
//  different questions, and only the log can answer the second — someone called
//  in March and again in July has a row that says July.
//
//  NOT is supported on an interval and means "no such event in that window",
//  which is how you ask the most useful question of all: in this audience, and
//  NOT contacted recently.
// ═══════════════════════════════════════════════════════════════════════════

export type IntervalDataset = 'calls' | 'messages' | 'signals' | 'walkins'

export interface Interval {
  dataset: IntervalDataset
  // Window: EITHER a relative lookback OR an absolute range.
  // Relative moves every time an audience refreshes; absolute does not. Both
  // are legitimate; which one you chose must stay visible in the UI.
  days?: number
  from?: string          // YYYY-MM-DD, inclusive
  to?: string            // YYYY-MM-DD, inclusive (whole day)
  not?: boolean          // "no such event in this window"
  // Optional narrowing, per dataset.
  interests?: string[]   // signals
  sources?: string[]     // signals
  intents?: string[]     // calls
  topics?: string[]      // calls
}

export interface DatasetDef {
  key: IntervalDataset
  label: string
  verb: string           // reads as "<verb> between …"
  // Honest note about what the underlying data can actually support.
  caveat?: string
}

export const DATASETS: DatasetDef[] = [
  { key: 'calls',    label: 'Called',      verb: 'we called them' },
  { key: 'messages', label: 'Messaged us', verb: 'they messaged us' },
  { key: 'walkins',  label: 'Walked in',   verb: 'they visited the store',
    caveat: 'Visit history starts 19 Jul 2026 — earlier visits were overwritten and are gone.' },
  { key: 'signals',  label: 'Interest seen', verb: 'an interest was recorded',
    caveat: 'An interest keeps only its LATEST sighting per channel, so re-mentioning it moves the date. This finds the last sighting, not every one.' },
]

const SOURCES = new Set(['sales', 'whatsapp', 'call', 'walkin', 'billing', 'ad'])
const INTENTS = new Set(['will_come', 'not_sure', 'wont_come', 'dont_call'])
const TOPICS = new Set(['rate', 'designs', 'offers', 'booking'])
const INTERESTS = new Set<string>(INTEREST_KEYS)

function daysAgoISO(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - Math.max(0, Math.floor(days)))
  return d.toLocaleDateString('en-CA')
}

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

/** The window as [startISO, endISO), or null when the interval says nothing. */
export function windowOf(iv: Interval): { start: string | null; end: string | null } | null {
  if (typeof iv.days === 'number' && Number.isFinite(iv.days)) {
    return { start: `${daysAgoISO(iv.days)}T00:00:00`, end: null }
  }
  if (!isDate(iv.from) && !isDate(iv.to)) return null
  const start = isDate(iv.from) ? `${iv.from}T00:00:00` : null
  let end: string | null = null
  if (isDate(iv.to)) {
    // Inclusive of the whole end day: compare against the start of the next.
    const d = new Date(`${iv.to}T00:00:00`)
    d.setDate(d.getDate() + 1)
    end = d.toISOString()
  }
  return { start, end }
}

/** Plain-English, for the audience list and the docs. */
export function describeInterval(iv: Interval): string {
  const ds = DATASETS.find(d => d.key === iv.dataset)
  const not = iv.not ? 'NOT ' : ''
  const what = ds?.label ?? iv.dataset
  const extra: string[] = []
  if (iv.interests?.length) extra.push(iv.interests.join('/'))
  if (iv.sources?.length) extra.push(`from ${iv.sources.join('/')}`)
  if (iv.intents?.length) extra.push(iv.intents.join('/'))
  if (iv.topics?.length) extra.push(`about ${iv.topics.join('/')}`)
  const tail = extra.length ? ` (${extra.join(', ')})` : ''
  if (typeof iv.days === 'number') return `${not}${what} in last ${iv.days}d${tail}`
  if (iv.from && iv.to) return `${not}${what} ${iv.from} → ${iv.to}${tail}`
  if (iv.from) return `${not}${what} on/after ${iv.from}${tail}`
  if (iv.to) return `${not}${what} on/before ${iv.to}${tail}`
  return `${not}${what}${tail}`
}

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
export function isUsableInterval(iv: Interval): boolean {
  return !!DATASETS.find(d => d.key === iv.dataset) && windowOf(iv) !== null
}
