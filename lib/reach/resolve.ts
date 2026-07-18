import { supabaseAdmin } from '@/lib/supabase/admin'
import { INTEREST_KEYS } from '@/lib/signals'
import type { ReachFilter } from '@/lib/types'

// Cohort resolution — turn a ReachFilter into the SET of matching phones.
// Shared by /api/reach/resolve (preview) and /api/campaigns/create + refresh
// (membership), so "who's in this cohort" is defined in exactly one place.
//
// Each active filter family produces a Set<phone>; the cohort is their
// INTERSECTION (AND). A manual `phones` list is used alone (paste mode).
//
// DO-NOT-CONTACT: applied ONCE, at the end, from the unified `contacts.is_opted_out`
// (chat STOP ∪ call DNC ∪ manual) — never per-family. Policy: opted out = no chat
// and no call, but ADS are still allowed, so an ad/export caller passes
// { includeOptedOut: true }. Before this, families filtered on the call-only
// `is_do_not_call`, which meant a cohort's member count and what actually got sent
// disagreed: call-DNC people were missing from the count, chat-STOP people were
// counted but never sent to.

type Sb = typeof supabaseAdmin

export function tenDigit(raw: string | null | undefined): string {
  const d = (raw ?? '').replace(/\D/g, '')
  return d.length > 10 && d.startsWith('91') ? d.slice(-10) : d
}

export function markerActive(f: ReachFilter): boolean {
  return !!(f.recency_tier?.length || f.value_tier?.length || f.rfm_segment?.length ||
    f.frequency_tier?.length || f.primary_metal?.length || f.is_high_value ||
    f.is_likely_wedding || f.is_lookalike_seed || f.min_lifetime_value != null ||
    f.min_total_bills != null || f.max_days_since_last_purchase != null ||
    f.purchaseFrom || f.purchaseTo)
}

async function markerPhones(sb: Sb, f: ReachFilter): Promise<Set<string>> {
  const set = new Set<string>()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    let q = sb.from('wa_b_customers')
      .select('phone, wa_b_markers!inner(customer_id)')
    if (f.recency_tier?.length)   q = q.in('wa_b_markers.recency_tier', f.recency_tier)
    if (f.value_tier?.length)     q = q.in('wa_b_markers.value_tier', f.value_tier)
    if (f.rfm_segment?.length)    q = q.in('wa_b_markers.rfm_segment', f.rfm_segment)
    if (f.frequency_tier?.length) q = q.in('wa_b_markers.frequency_tier', f.frequency_tier)
    if (f.primary_metal?.length)  q = q.in('wa_b_markers.primary_metal', f.primary_metal)
    if (f.is_high_value)          q = q.eq('wa_b_markers.is_high_value', true)
    if (f.is_likely_wedding)      q = q.eq('wa_b_markers.is_likely_wedding', true)
    if (f.is_lookalike_seed)      q = q.contains('wa_b_markers.audience_labels', ['Lookalike Seed'])
    if (f.min_lifetime_value != null) q = q.gte('wa_b_markers.lifetime_value', f.min_lifetime_value)
    if (f.min_total_bills != null)    q = q.gte('wa_b_markers.total_bills', f.min_total_bills)
    if (f.max_days_since_last_purchase != null)
      q = q.lte('wa_b_markers.days_since_last_purchase', f.max_days_since_last_purchase)
    if (f.purchaseFrom) q = q.gte('wa_b_markers.last_purchase_date', f.purchaseFrom)
    if (f.purchaseTo)   q = q.lte('wa_b_markers.last_purchase_date', f.purchaseTo)
    const { data } = await q.range(from, from + PAGE - 1)
    const rows = (data ?? []) as { phone: string }[]
    for (const r of rows) set.add(tenDigit(r.phone))
    if (rows.length < PAGE) break
  }
  return set
}

async function phonesForIds(sb: Sb, ids: string[]): Promise<Set<string>> {
  const set = new Set<string>()
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await sb.from('wa_b_customers').select('phone').in('id', ids.slice(i, i + 300))
    for (const r of (data ?? []) as { phone: string }[]) set.add(tenDigit(r.phone))
  }
  return set
}

async function pagedIds<T extends { customer_id: string }>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<string[]> {
  const ids: string[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data } = await build(from, from + PAGE - 1)
    const rows = data ?? []
    ids.push(...rows.map(r => r.customer_id))
    if (rows.length < PAGE) break
  }
  return ids
}

function intersect(sets: Set<string>[]): Set<string> {
  if (sets.length === 0) return new Set()
  sets.sort((a, b) => a.size - b.size)
  const [smallest, ...rest] = sets
  const out = new Set<string>()
  for (const p of smallest) if (rest.every(s => s.has(p))) out.add(p)
  return out
}

// Every phone that has opted out of contact (chat STOP ∪ call DNC ∪ manual).
async function optedOutPhones(sb: Sb): Promise<Set<string>> {
  const set = new Set<string>()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data } = await sb.from('contacts').select('phone')
      .eq('is_opted_out', true).range(from, from + PAGE - 1)
    const rows = (data ?? []) as { phone: string }[]
    for (const r of rows) set.add(tenDigit(r.phone))
    if (rows.length < PAGE) break
  }
  return set
}

export interface ResolveOptions {
  // Ads may target people who opted out of chat/call — that opt-out is about
  // messaging us contacting them, not about being shown an ad. Only ad/export
  // callers should set this.
  includeOptedOut?: boolean
}

// Drop anyone who has opted out, unless this is an ad/export resolve.
async function applyOptOut(sb: Sb, phones: Set<string>, opts: ResolveOptions): Promise<Set<string>> {
  if (opts.includeOptedOut) return phones
  const out = await optedOutPhones(sb)
  if (out.size === 0) return phones
  const kept = new Set<string>()
  for (const p of phones) if (!out.has(p)) kept.add(p)
  return kept
}

// LEGACY resolver — derives every family from the raw event tables and intersects
// in app memory. Superseded by the view-backed resolveCohortPhones below; kept
// ONLY as the oracle for scripts/parity-check.mjs and deleted once that has run
// clean against real data. Do not call it from app code.
export async function resolveCohortPhonesLegacy(
  f: ReachFilter,
  opts: ResolveOptions = {},
): Promise<{ phones: Set<string>; error?: string }> {
  const sb = supabaseAdmin

  const manual = (f.phones ?? []).map(tenDigit).filter(p => p.length === 10)
  if (manual.length) return { phones: await applyOptOut(sb, new Set(manual), opts) }

  const families: Set<string>[] = []

  if (markerActive(f)) families.push(await markerPhones(sb, f))

  if (f.campaignIds?.length) {
    const ids = await pagedIds<{ customer_id: string }>((from, to) =>
      sb.from('wa_b_call_tasks').select('customer_id').in('campaign_id', f.campaignIds!).range(from, to))
    families.push(await phonesForIds(sb, [...new Set(ids)]))
  }

  const callLogActive = !!(f.intents?.length || f.callTopics?.length || f.calledFrom || f.calledTo)
  if (callLogActive) {
    const ids = await pagedIds<{ customer_id: string }>((from, to) => {
      let q = sb.from('wa_b_call_logs').select('customer_id')
      if (f.intents?.length) q = q.in('intent', f.intents)
      if (f.callTopics?.length) q = q.overlaps('topics', f.callTopics)
      if (f.calledFrom) q = q.gte('called_at', `${f.calledFrom}T00:00:00`)
      if (f.calledTo) { const d = new Date(`${f.calledTo}T00:00:00`); d.setDate(d.getDate() + 1); q = q.lt('called_at', d.toISOString()) }
      return q.range(from, to)
    })
    families.push(await phonesForIds(sb, [...new Set(ids)]))
  }

  if (f.hotLead) {
    const set = new Set<string>()
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data } = await sb.from('wa_b_customers').select('phone')
        .eq('is_hot_lead', true).range(from, from + PAGE - 1)
      const rows = (data ?? []) as { phone: string }[]
      for (const r of rows) set.add(tenDigit(r.phone))
      if (rows.length < PAGE) break
    }
    families.push(set)
  }

  if (f.subscribedTopics?.length) {
    const ids = await pagedIds<{ customer_id: string }>((from, to) =>
      sb.from('wa_customer_interests').select('customer_id').in('topic_id', f.subscribedTopics!).range(from, to))
    const set = new Set<string>()
    const uniq = [...new Set(ids)]
    for (let i = 0; i < uniq.length; i += 300) {
      const { data } = await sb.from('wa_customers').select('phone').in('id', uniq.slice(i, i + 300))
      for (const r of (data ?? []) as { phone: string }[]) set.add(tenDigit(r.phone))
    }
    families.push(set)
  }

  // Signals family — interests, source facet, and/or a "tagged between" date range.
  const signalsActive = !!(f.interests?.length || f.interestSources?.length || f.interestFrom || f.interestTo)
  if (signalsActive) {
    const set = new Set<string>()
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      let q = sb.from('wa_signals').select('phone')
      if (f.interests?.length) q = q.in('interest', f.interests)
      if (f.interestSources?.length) q = q.in('source', f.interestSources)
      if (f.interestFrom) q = q.gte('last_seen', `${f.interestFrom}T00:00:00`)
      if (f.interestTo) { const d = new Date(`${f.interestTo}T00:00:00`); d.setDate(d.getDate() + 1); q = q.lt('last_seen', d.toISOString()) }
      const { data } = await q.range(from, from + PAGE - 1)
      const rows = (data ?? []) as { phone: string }[]
      for (const r of rows) set.add(tenDigit(r.phone))
      if (rows.length < PAGE) break
    }
    families.push(set)
  }

  // Chat-activity family: customers who messaged us (inbound) in a date window.
  if (f.messagedFrom || f.messagedTo) {
    const threadIds = await pagedIds<{ customer_id: string }>((from, to) => {
      let q = sb.from('wa_messages').select('thread_id').eq('direction', 'inbound')
      if (f.messagedFrom) q = q.gte('created_at', `${f.messagedFrom}T00:00:00`)
      if (f.messagedTo) { const d = new Date(`${f.messagedTo}T00:00:00`); d.setDate(d.getDate() + 1); q = q.lt('created_at', d.toISOString()) }
      return q.range(from, to).then(r => ({ data: (r.data ?? []).map((x: { thread_id: string }) => ({ customer_id: x.thread_id })) }))
    })
    const set = new Set<string>()
    const uniq = [...new Set(threadIds)]
    for (let i = 0; i < uniq.length; i += 300) {
      const { data } = await sb.from('wa_threads').select('phone').in('id', uniq.slice(i, i + 300))
      for (const r of (data ?? []) as { phone: string }[]) set.add(tenDigit(r.phone))
    }
    families.push(set)
  }

  // Walk-in visit family (wa_b_customers.walkin_at / walkin_timing). walkedIn +
  // walkinNoPurchase need only walkin_at (pre-wa_041 safe); walkinTiming needs wa_041.
  const walkinActive = !!(f.walkedIn || f.walkinNoPurchase || f.walkinTiming?.length)
  if (walkinActive) {
    const set = new Set<string>()
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      let q = sb.from('wa_b_customers')
        .select('phone, walkin_at, wa_b_markers(last_purchase_date)')
        .not('walkin_at', 'is', null)
      if (f.walkinTiming?.length) q = q.in('walkin_timing', f.walkinTiming)
      const { data } = await q.range(from, from + PAGE - 1)
      const rows = (data ?? []) as Array<{ phone: string; walkin_at: string; wa_b_markers: { last_purchase_date: string | null } | { last_purchase_date: string | null }[] | null }>
      for (const r of rows) {
        if (f.walkinNoPurchase) {
          const m = Array.isArray(r.wa_b_markers) ? r.wa_b_markers[0] : r.wa_b_markers
          const last = m?.last_purchase_date ?? null
          if (last && r.walkin_at && last >= r.walkin_at.slice(0, 10)) continue  // converted → exclude
        }
        set.add(tenDigit(r.phone))
      }
      if (rows.length < PAGE) break
    }
    families.push(set)
  }

  // Call-unresponsive: >=3 attempts, never connected (route off calls).
  if (f.callUnresponsive) {
    const agg = new Map<string, { total: number; succ: number }>()
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data } = await sb.from('wa_b_call_logs').select('customer_id, success').range(from, from + PAGE - 1)
      const rows = (data ?? []) as Array<{ customer_id: string; success: boolean | null }>
      for (const r of rows) {
        const a = agg.get(r.customer_id) ?? { total: 0, succ: 0 }
        a.total++; if (r.success === true) a.succ++
        agg.set(r.customer_id, a)
      }
      if (rows.length < PAGE) break
    }
    const cids = [...agg.entries()].filter(([, v]) => v.total >= 3 && v.succ === 0).map(([cid]) => cid)
    families.push(await phonesForIds(sb, cids))
  }

  // Multi-source intent: interest signals from >=2 distinct sources.
  if (f.multiSource) {
    const bySrc = new Map<string, Set<string>>()
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data } = await sb.from('wa_signals').select('phone, source').range(from, from + PAGE - 1)
      const rows = (data ?? []) as Array<{ phone: string; source: string }>
      for (const r of rows) {
        const p = tenDigit(r.phone)
        let s = bySrc.get(p); if (!s) { s = new Set(); bySrc.set(p, s) }
        s.add(r.source)
      }
      if (rows.length < PAGE) break
    }
    const set = new Set<string>()
    for (const [p, s] of bySrc) if (s.size >= 2) set.add(p)
    families.push(set)
  }

  // Chat non-buyer: has a chat interest signal, no sales markers on this number.
  if (f.chatNonBuyer) {
    const chat = new Set<string>()
    const buyers = new Set<string>()
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data } = await sb.from('wa_signals').select('phone').eq('source', 'whatsapp').range(from, from + PAGE - 1)
      const rows = (data ?? []) as { phone: string }[]
      for (const r of rows) chat.add(tenDigit(r.phone))
      if (rows.length < PAGE) break
    }
    for (let from = 0; ; from += PAGE) {
      const { data } = await sb.from('wa_b_customers').select('phone, wa_b_markers!inner(customer_id)').range(from, from + PAGE - 1)
      const rows = (data ?? []) as { phone: string }[]
      for (const r of rows) buyers.add(tenDigit(r.phone))
      if (rows.length < PAGE) break
    }
    const set = new Set<string>()
    for (const p of chat) if (!buyers.has(p)) set.add(p)
    families.push(set)
  }

  // Ad-lead family (wa_ad_leads — table may not exist until the ad migration; guard).
  if (f.adLead || f.adCampaign?.length) {
    const set = new Set<string>()
    let q = sb.from('wa_ad_leads').select('phone')
    if (f.adCampaign?.length) q = q.in('ad_campaign', f.adCampaign)
    const { data, error } = await q
    if (!error) for (const r of (data ?? []) as { phone: string }[]) set.add(tenDigit(r.phone))
    families.push(set)
  }

  if (families.length === 0) return { phones: new Set(), error: 'Add at least one filter or paste numbers.' }
  return { phones: await applyOptOut(sb, intersect(families), opts) }
}

// ═══════════════════════════════════════════════════════════════════════════
//  VIEW-BACKED RESOLVER (wa_046 `customer_features`)
//
//  Almost every filter is a question about a PERSON, and the view answers those
//  in one indexed query instead of paging whole tables into app memory. The
//  three worst offenders — multi-source, chat-non-buyer, call-unresponsive —
//  each used to scan an entire table and aggregate in JS; they are now single
//  columns.
//
//  WHAT STAYS ON THE EVENT TABLES, and why it isn't laziness: a person-level
//  column cannot answer "was there an EVENT inside this window".
//    · called between / messaged between / signal seen between
//    · intent AND topic together — today that means "one call had both", which
//      is stricter than "has ever said X" AND "has ever discussed Y"
//    · subscribed topics — the filter stores topic UUIDs while the view stores
//      canonical keys, and several topics share a key (parent + child), so
//      mapping would silently widen the cohort
//  Those keep their event queries and are intersected in exactly as before, so
//  behaviour is unchanged. Everything else moved.
// ═══════════════════════════════════════════════════════════════════════════

const SIGNAL_SOURCES = new Set(['sales', 'whatsapp', 'call', 'walkin', 'billing', 'ad'])
const INTEREST_SET = new Set<string>(INTEREST_KEYS)

// Call filters must be answered row-by-row when a date window is involved, or
// when intent AND topic are both set (they must hold on the SAME call).
function callNeedsEventQuery(f: ReachFilter): boolean {
  return !!(f.calledFrom || f.calledTo || (f.intents?.length && f.callTopics?.length))
}
// A signal's date lives per-interest as a max, not per (interest, source) row —
// so a "seen between" window has to go back to wa_signals.
function signalNeedsEventQuery(f: ReachFilter): boolean {
  return !!(f.interestFrom || f.interestTo)
}

// interests × their source facet → one OR across the per-interest columns.
// `int_wedding_src ov {walkin}` is exactly "a wedding signal that came from a
// walk-in", so this stays row-accurate without touching wa_signals.
// Keys and sources are whitelisted before going into the PostgREST or() string.
function interestOr(f: ReachFilter): string | null {
  const keys = (f.interests ?? []).filter(k => INTEREST_SET.has(k))
  if (!keys.length) return null
  const srcs = (f.interestSources ?? []).filter(s => SIGNAL_SOURCES.has(s))
  return keys
    .map(k => (srcs.length ? `int_${k}_src.ov.{${srcs.join(',')}}` : `int_${k}_src.not.is.null`))
    .join(',')
}

// Does this filter have anything the view can answer?
function viewActive(f: ReachFilter): boolean {
  if (markerActive(f)) return true
  if (f.hotLead || f.callUnresponsive || f.multiSource || f.chatNonBuyer) return true
  if (f.walkedIn || f.walkinNoPurchase || f.walkinTiming?.length) return true
  if (f.adLead || f.adCampaign?.length || f.campaignIds?.length) return true
  if (!callNeedsEventQuery(f) && (f.intents?.length || f.callTopics?.length)) return true
  if (!signalNeedsEventQuery(f) && (f.interests?.length || f.interestSources?.length)) return true
  return false
}

async function viewPhones(sb: Sb, f: ReachFilter): Promise<{ set: Set<string>; error?: string }> {
  const set = new Set<string>()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    let q = sb.from('customer_features').select('phone')

    // sales
    if (f.recency_tier?.length)   q = q.in('sales_recency_tier', f.recency_tier)
    if (f.value_tier?.length)     q = q.in('sales_value_tier', f.value_tier)
    if (f.rfm_segment?.length)    q = q.in('sales_rfm_segment', f.rfm_segment)
    if (f.frequency_tier?.length) q = q.in('sales_frequency_tier', f.frequency_tier)
    if (f.primary_metal?.length)  q = q.in('sales_primary_metal', f.primary_metal)
    if (f.is_high_value)          q = q.eq('sales_is_high_value', true)
    if (f.is_likely_wedding)      q = q.eq('sales_is_likely_wedding', true)
    if (f.is_lookalike_seed)      q = q.eq('sales_is_lookalike_seed', true)
    if (f.min_lifetime_value != null) q = q.gte('sales_lifetime_value', f.min_lifetime_value)
    if (f.min_total_bills != null)    q = q.gte('sales_total_bills', f.min_total_bills)
    if (f.max_days_since_last_purchase != null)
      q = q.lte('sales_days_since_purchase', f.max_days_since_last_purchase)
    if (f.purchaseFrom) q = q.gte('sales_last_purchase_date', f.purchaseFrom)
    if (f.purchaseTo)   q = q.lte('sales_last_purchase_date', f.purchaseTo)

    // call
    if (f.hotLead) q = q.eq('call_is_hot', true)
    if (f.campaignIds?.length) q = q.overlaps('call_campaign_ids', f.campaignIds)
    if (f.callUnresponsive) q = q.gte('call_attempts', 3).eq('call_connected', 0)
    if (!callNeedsEventQuery(f)) {
      if (f.intents?.length)    q = q.overlaps('call_intents', f.intents)
      if (f.callTopics?.length) q = q.overlaps('call_topics', f.callTopics)
    }

    // walk-in
    if (f.walkedIn)             q = q.not('walkin_last_at', 'is', null)
    if (f.walkinNoPurchase)     q = q.eq('walkin_no_purchase', true)
    if (f.walkinTiming?.length) q = q.in('walkin_timing', f.walkinTiming)

    // behaviour
    if (f.multiSource)  q = q.gte('signal_source_count', 2)
    if (f.chatNonBuyer) q = q.contains('signal_sources', ['whatsapp']).eq('is_buyer', false)

    // ads
    if (f.adLead)              q = q.eq('ad_is_lead', true)
    if (f.adCampaign?.length)  q = q.overlaps('ad_campaigns', f.adCampaign)

    // interests + source facet
    if (!signalNeedsEventQuery(f)) {
      const or = interestOr(f)
      if (or) q = q.or(or)
      else if (f.interestSources?.length && !f.interests?.length) {
        const srcs = f.interestSources.filter(s => SIGNAL_SOURCES.has(s))
        if (srcs.length) q = q.overlaps('signal_sources', srcs)
      }
    }

    const { data, error } = await q.range(from, from + PAGE - 1)
    if (error) return { set, error: `customer_features: ${error.message}` }
    const rows = (data ?? []) as { phone: string }[]
    for (const r of rows) set.add(tenDigit(r.phone))
    if (rows.length < PAGE) break
  }
  return { set }
}

export async function resolveCohortPhones(
  f: ReachFilter,
  opts: ResolveOptions = {},
): Promise<{ phones: Set<string>; error?: string }> {
  const sb = supabaseAdmin

  const manual = (f.phones ?? []).map(tenDigit).filter(p => p.length === 10)
  if (manual.length) return { phones: await applyOptOut(sb, new Set(manual), opts) }

  const families: Set<string>[] = []

  if (viewActive(f)) {
    const { set, error } = await viewPhones(sb, f)
    if (error) {
      // The view is missing or behind (migration not applied yet on this
      // environment). Fall back to the legacy path rather than failing a send —
      // a cohort resolving to an error is worse than resolving slowly. Remove
      // this fallback, and the legacy resolver, once wa_046 is everywhere.
      console.warn('[resolve] customer_features unavailable, using legacy path:', error)
      return resolveCohortPhonesLegacy(f, opts)
    }
    families.push(set)
  }

  // ── event-window families (see the note above) ──
  if (callNeedsEventQuery(f)) {
    const ids = await pagedIds<{ customer_id: string }>((from, to) => {
      let q = sb.from('wa_b_call_logs').select('customer_id')
      if (f.intents?.length) q = q.in('intent', f.intents)
      if (f.callTopics?.length) q = q.overlaps('topics', f.callTopics)
      if (f.calledFrom) q = q.gte('called_at', `${f.calledFrom}T00:00:00`)
      if (f.calledTo) { const d = new Date(`${f.calledTo}T00:00:00`); d.setDate(d.getDate() + 1); q = q.lt('called_at', d.toISOString()) }
      return q.range(from, to)
    })
    families.push(await phonesForIds(sb, [...new Set(ids)]))
  }

  if (signalNeedsEventQuery(f)) {
    const set = new Set<string>()
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      let q = sb.from('wa_signals').select('phone')
      if (f.interests?.length) q = q.in('interest', f.interests)
      if (f.interestSources?.length) q = q.in('source', f.interestSources)
      if (f.interestFrom) q = q.gte('last_seen', `${f.interestFrom}T00:00:00`)
      if (f.interestTo) { const d = new Date(`${f.interestTo}T00:00:00`); d.setDate(d.getDate() + 1); q = q.lt('last_seen', d.toISOString()) }
      const { data } = await q.range(from, from + PAGE - 1)
      const rows = (data ?? []) as { phone: string }[]
      for (const r of rows) set.add(tenDigit(r.phone))
      if (rows.length < PAGE) break
    }
    families.push(set)
  }

  if (f.messagedFrom || f.messagedTo) {
    const threadIds = await pagedIds<{ customer_id: string }>((from, to) => {
      let q = sb.from('wa_messages').select('thread_id').eq('direction', 'inbound')
      if (f.messagedFrom) q = q.gte('created_at', `${f.messagedFrom}T00:00:00`)
      if (f.messagedTo) { const d = new Date(`${f.messagedTo}T00:00:00`); d.setDate(d.getDate() + 1); q = q.lt('created_at', d.toISOString()) }
      return q.range(from, to).then(r => ({ data: (r.data ?? []).map((x: { thread_id: string }) => ({ customer_id: x.thread_id })) }))
    })
    const set = new Set<string>()
    const uniq = [...new Set(threadIds)]
    for (let i = 0; i < uniq.length; i += 300) {
      const { data } = await sb.from('wa_threads').select('phone').in('id', uniq.slice(i, i + 300))
      for (const r of (data ?? []) as { phone: string }[]) set.add(tenDigit(r.phone))
    }
    families.push(set)
  }

  if (f.subscribedTopics?.length) {
    const ids = await pagedIds<{ customer_id: string }>((from, to) =>
      sb.from('wa_customer_interests').select('customer_id').in('topic_id', f.subscribedTopics!).range(from, to))
    const set = new Set<string>()
    const uniq = [...new Set(ids)]
    for (let i = 0; i < uniq.length; i += 300) {
      const { data } = await sb.from('wa_customers').select('phone').in('id', uniq.slice(i, i + 300))
      for (const r of (data ?? []) as { phone: string }[]) set.add(tenDigit(r.phone))
    }
    families.push(set)
  }

  if (families.length === 0) return { phones: new Set(), error: 'Add at least one filter or paste numbers.' }
  return { phones: await applyOptOut(sb, intersect(families), opts) }
}
