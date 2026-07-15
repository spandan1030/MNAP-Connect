import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import type { ReachFilter, ReachRecipient } from '@/lib/types'

// Reach — resolve a cohort from any mix of signal universes into a phone list,
// each decorated with markers, opt-out flags, prior successful sends, and (if a
// template is given) whether it's currently suppressed for that template.
//   POST { filter, templateId? } -> { total, capped, recipients }
//
// Active filter families each produce a Set<phone>; the cohort is their
// INTERSECTION (AND). A manual `phones` list is used alone (paste mode).
// Everyone messageable lives by PHONE, so we resolve to phones throughout.

const DECORATE_CAP = 1000  // fully-decorate at most this many; narrow if more

function tenDigit(raw: string | null | undefined): string {
  const d = (raw ?? '').replace(/\D/g, '')
  return d.length > 10 && d.startsWith('91') ? d.slice(-10) : d
}

type Sb = typeof supabaseAdmin

// Marker family: wa_b_customers ⋈ wa_b_markers filtered by marker criteria.
function markerActive(f: ReachFilter): boolean {
  return !!(f.recency_tier?.length || f.value_tier?.length || f.rfm_segment?.length ||
    f.frequency_tier?.length || f.primary_metal?.length || f.is_high_value ||
    f.is_likely_wedding || f.is_lookalike_seed || f.min_lifetime_value != null ||
    f.min_total_bills != null || f.max_days_since_last_purchase != null)
}

async function markerPhones(sb: Sb, f: ReachFilter): Promise<Set<string>> {
  const set = new Set<string>()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    let q = sb.from('wa_b_customers')
      .select('phone, wa_b_markers!inner(customer_id)')
      .eq('is_do_not_call', false)
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
    const { data } = await q.range(from, from + PAGE - 1)
    const rows = (data ?? []) as { phone: string }[]
    for (const r of rows) set.add(tenDigit(r.phone))
    if (rows.length < PAGE) break
  }
  return set
}

// Phones for a set of wa_b_customers ids (chunked .in()).
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

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { filter, templateId } = (await req.json()) as { filter?: ReachFilter; templateId?: string }
  const f: ReachFilter = filter ?? {}

  // ── 1. Resolve candidate phones ──────────────────────────────────────────
  let candidate: Set<string>

  const manual = (f.phones ?? []).map(tenDigit).filter(p => p.length === 10)
  if (manual.length) {
    candidate = new Set(manual)
  } else {
    const families: Set<string>[] = []

    if (markerActive(f)) families.push(await markerPhones(supabaseAdmin, f))

    if (f.campaignIds?.length) {
      const ids = await pagedIds<{ customer_id: string }>((from, to) =>
        supabaseAdmin.from('wa_b_call_tasks').select('customer_id').in('campaign_id', f.campaignIds!).range(from, to))
      families.push(await phonesForIds(supabaseAdmin, [...new Set(ids)]))
    }

    const callLogActive = !!(f.intents?.length || f.callTopics?.length || f.calledFrom || f.calledTo)
    if (callLogActive) {
      const ids = await pagedIds<{ customer_id: string }>((from, to) => {
        let q = supabaseAdmin.from('wa_b_call_logs').select('customer_id')
        if (f.intents?.length) q = q.in('intent', f.intents)
        if (f.callTopics?.length) q = q.overlaps('topics', f.callTopics)
        if (f.calledFrom) q = q.gte('called_at', `${f.calledFrom}T00:00:00`)
        if (f.calledTo) { const d = new Date(`${f.calledTo}T00:00:00`); d.setDate(d.getDate() + 1); q = q.lt('called_at', d.toISOString()) }
        return q.range(from, to)
      })
      families.push(await phonesForIds(supabaseAdmin, [...new Set(ids)]))
    }

    if (f.hotLead) {
      const set = new Set<string>()
      const PAGE = 1000
      for (let from = 0; ; from += PAGE) {
        const { data } = await supabaseAdmin.from('wa_b_customers').select('phone')
          .eq('is_hot_lead', true).eq('is_do_not_call', false).range(from, from + PAGE - 1)
        const rows = (data ?? []) as { phone: string }[]
        for (const r of rows) set.add(tenDigit(r.phone))
        if (rows.length < PAGE) break
      }
      families.push(set)
    }

    if (f.subscribedTopics?.length) {
      // Opt-in consent family: customers (Type A) subscribed to any of these
      // topics — reproduces the old topic broadcast as a segment condition.
      const ids = await pagedIds<{ customer_id: string }>((from, to) =>
        supabaseAdmin.from('wa_customer_interests').select('customer_id').in('topic_id', f.subscribedTopics!).range(from, to))
      const set = new Set<string>()
      const uniq = [...new Set(ids)]
      for (let i = 0; i < uniq.length; i += 300) {
        const { data } = await supabaseAdmin.from('wa_customers').select('phone').in('id', uniq.slice(i, i + 300))
        for (const r of (data ?? []) as { phone: string }[]) set.add(tenDigit(r.phone))
      }
      families.push(set)
    }

    if (f.interests?.length) {
      const set = new Set<string>()
      const PAGE = 1000
      for (let from = 0; ; from += PAGE) {
        let q = supabaseAdmin.from('wa_signals').select('phone').in('interest', f.interests)
        // Source facet: 'whatsapp' (chat) | 'call' | 'sales'. Empty = any source.
        if (f.interestSources?.length) q = q.in('source', f.interestSources)
        const { data } = await q.range(from, from + PAGE - 1)
        const rows = (data ?? []) as { phone: string }[]
        for (const r of rows) set.add(tenDigit(r.phone))
        if (rows.length < PAGE) break
      }
      families.push(set)
    }

    if (families.length === 0) {
      return Response.json({ error: 'Add at least one filter or paste numbers.' }, { status: 400 })
    }
    candidate = intersect(families)
  }

  const total = candidate.size
  const phones = [...candidate].slice(0, DECORATE_CAP)

  // ── 2. Decorate the (capped) phone list ──────────────────────────────────
  // Customer + markers by phone.
  const custByPhone = new Map<string, { id: string; name: string | null; is_hot_lead: boolean; is_do_not_call: boolean }>()
  const markerByPhone = new Map<string, Record<string, unknown>>()
  for (let i = 0; i < phones.length; i += 300) {
    const chunk = phones.slice(i, i + 300)
    const { data } = await supabaseAdmin.from('wa_b_customers')
      .select('id, phone, name, is_hot_lead, is_do_not_call, wa_b_markers(recency_tier,value_tier,rfm_segment,primary_metal,lifetime_value)')
      .in('phone', chunk)
    for (const c of (data ?? []) as unknown as Array<{ id: string; phone: string; name: string | null; is_hot_lead: boolean; is_do_not_call: boolean; wa_b_markers: Record<string, unknown> | null }>) {
      const p = tenDigit(c.phone)
      custByPhone.set(p, { id: c.id, name: c.name, is_hot_lead: c.is_hot_lead, is_do_not_call: c.is_do_not_call })
      const mk = Array.isArray(c.wa_b_markers) ? c.wa_b_markers[0] : c.wa_b_markers
      if (mk) markerByPhone.set(p, mk as Record<string, unknown>)
    }
  }

  // Unified consent + display name from the contact spine (covers chat-only
  // leads that have no wa_b_customers row). chat_opted_out = STOP, call_opted_out = DNC.
  const contactByPhone = new Map<string, { name: string | null; chat: boolean; call: boolean }>()
  for (let i = 0; i < phones.length; i += 300) {
    const { data } = await supabaseAdmin.from('contacts')
      .select('phone, name, name_override, chat_opted_out, call_opted_out').in('phone', phones.slice(i, i + 300))
    for (const r of (data ?? []) as Array<{ phone: string; name: string | null; name_override: string | null; chat_opted_out: boolean; call_opted_out: boolean }>) {
      contactByPhone.set(tenDigit(r.phone), { name: r.name_override || r.name, chat: r.chat_opted_out, call: r.call_opted_out })
    }
  }

  // Prior sends (last 90d) for history + suppression.
  const since = new Date(); since.setDate(since.getDate() - 90)
  const ledgerByPhone = new Map<string, Array<{ label: string; category: string | null; sentAt: string; key: string }>>()
  for (let i = 0; i < phones.length; i += 300) {
    const { data } = await supabaseAdmin.from('wa_send_ledger')
      .select('phone, meta_template_name, category, suppression_key, sent_at, template:wa_message_templates(name)')
      .in('phone', phones.slice(i, i + 300)).eq('status', 'sent').gte('sent_at', since.toISOString())
      .order('sent_at', { ascending: false })
    for (const r of (data ?? []) as unknown as Array<{ phone: string; meta_template_name: string | null; category: string | null; suppression_key: string; sent_at: string; template: { name: string } | null }>) {
      const p = tenDigit(r.phone)
      const tname = Array.isArray(r.template) ? r.template[0]?.name : r.template?.name
      const arr = ledgerByPhone.get(p) ?? []
      arr.push({ label: tname ?? r.meta_template_name ?? r.category ?? 'message', category: r.category, sentAt: r.sent_at, key: r.suppression_key })
      ledgerByPhone.set(p, arr)
    }
  }

  // Suppression for the chosen template.
  let suppKey: string | null = null
  let suppDays = 0
  if (templateId) {
    const { data: tpl } = await supabaseAdmin.from('wa_message_templates')
      .select('id, suppression_bucket, suppression_days').eq('id', templateId).maybeSingle()
    if (tpl) { suppKey = tpl.suppression_bucket || tpl.id; suppDays = tpl.suppression_days ?? 0 }
  }

  const recipients: ReachRecipient[] = phones.map(p => {
    const c = custByPhone.get(p)
    const m = markerByPhone.get(p) ?? {}
    const ct = contactByPhone.get(p)
    const sends = ledgerByPhone.get(p) ?? []
    let suppressedUntil: string | null = null
    if (suppKey && suppDays > 0) {
      const hit = sends.find(s => s.key === suppKey)
      if (hit) {
        const until = new Date(hit.sentAt); until.setDate(until.getDate() + suppDays)
        if (until > new Date()) suppressedUntil = until.toISOString()
      }
    }
    return {
      phone: p,
      name: ct?.name ?? c?.name ?? null,
      customerId: c?.id ?? null,
      recency_tier: (m.recency_tier as string) ?? null,
      value_tier: (m.value_tier as string) ?? null,
      rfm_segment: (m.rfm_segment as string) ?? null,
      primary_metal: (m.primary_metal as string) ?? null,
      lifetime_value: (m.lifetime_value as number) ?? null,
      is_hot_lead: c?.is_hot_lead ?? false,
      is_do_not_call: ct?.call ?? c?.is_do_not_call ?? false,   // call DNC (unified)
      dnd: ct?.chat ?? false,                                    // chat STOP (unified)
      pastSends: sends.map(s => ({ label: s.label, category: s.category, sentAt: s.sentAt })),
      suppressedUntil,
    }
  })

  return Response.json({ total, capped: total > DECORATE_CAP, recipients })
}
