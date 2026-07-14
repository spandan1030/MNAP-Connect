import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import type { CallFilter } from '@/lib/types'

// Admin Call Control: preview how many customers match a marker filter, or
// create a campaign and generate the call cards (tasks) for them.
//   POST { preview: true, filter }      -> { count }
//   POST { name, filter }               -> { campaignId, taskCount }
// Do-not-call customers are always excluded.

type Body = { preview?: boolean; name?: string; filter?: CallFilter }

// Base query: customers (excluding DNC) inner-joined to their markers,
// filtered by the marker criteria. head=true returns only an exact count.
function tenDigit(raw: string | null | undefined): string {
  const d = (raw ?? '').replace(/\D/g, '')
  return d.length > 10 && d.startsWith('91') ? d.slice(-10) : d
}

// Set of phones that carry any of the requested interests (from wa_signals).
async function interestPhoneSet(interests: string[]): Promise<Set<string>> {
  const set = new Set<string>()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data } = await supabaseAdmin
      .from('wa_signals').select('phone').in('interest', interests).range(from, from + PAGE - 1)
    const rows = (data ?? []) as { phone: string }[]
    for (const r of rows) set.add(tenDigit(r.phone))
    if (rows.length < PAGE) break
  }
  return set
}

function buildQuery(filter: CallFilter, head: boolean) {
  let q = supabaseAdmin
    .from('wa_b_customers')
    .select('id, phone, wa_b_markers!inner(customer_id)', head ? { count: 'exact', head: true } : {})
    .eq('is_do_not_call', false)

  if (filter.recency_tier?.length)   q = q.in('wa_b_markers.recency_tier', filter.recency_tier)
  if (filter.value_tier?.length)     q = q.in('wa_b_markers.value_tier', filter.value_tier)
  if (filter.rfm_segment?.length)    q = q.in('wa_b_markers.rfm_segment', filter.rfm_segment)
  if (filter.frequency_tier?.length) q = q.in('wa_b_markers.frequency_tier', filter.frequency_tier)
  if (filter.primary_metal?.length)  q = q.in('wa_b_markers.primary_metal', filter.primary_metal)
  if (filter.is_high_value)          q = q.eq('wa_b_markers.is_high_value', true)
  if (filter.is_likely_wedding)      q = q.eq('wa_b_markers.is_likely_wedding', true)
  if (filter.is_lookalike_seed)      q = q.contains('wa_b_markers.audience_labels', ['Lookalike Seed'])
  if (filter.min_lifetime_value != null)  q = q.gte('wa_b_markers.lifetime_value', filter.min_lifetime_value)
  if (filter.min_total_bills != null)     q = q.gte('wa_b_markers.total_bills', filter.min_total_bills)
  if (filter.max_days_since_last_purchase != null)
    q = q.lte('wa_b_markers.days_since_last_purchase', filter.max_days_since_last_purchase)
  return q
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

  const { preview, name, filter } = (await req.json()) as Body
  const f: CallFilter = filter ?? {}

  // Resolve matching customer ids. Marker filters run in the DB; an interest
  // filter (wa_signals is phone-keyed, no FK to customers) intersects by phone.
  async function matchingIds(): Promise<{ ids: string[]; error?: string }> {
    const rows: { id: string; phone: string }[] = []
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await buildQuery(f, false).range(from, from + PAGE - 1)
      if (error) return { ids: [], error: error.message }
      const page = (data ?? []) as { id: string; phone: string }[]
      rows.push(...page)
      if (page.length < PAGE) break
    }
    if (!f.interests?.length) return { ids: rows.map(r => r.id) }
    const phones = await interestPhoneSet(f.interests)
    return { ids: rows.filter(r => phones.has(tenDigit(r.phone))).map(r => r.id) }
  }

  // ── Preview: just the count ──
  if (preview) {
    // Fast path: no interest filter -> exact head count.
    if (!f.interests?.length) {
      const { count, error } = await buildQuery(f, true)
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ count: count ?? 0 })
    }
    const { ids, error } = await matchingIds()
    if (error) return Response.json({ error }, { status: 500 })
    return Response.json({ count: ids.length })
  }

  // ── Create ──
  if (!name || !name.trim()) {
    return Response.json({ error: 'Campaign name required' }, { status: 400 })
  }

  const { ids, error: matchErr } = await matchingIds()
  if (matchErr) return Response.json({ error: matchErr }, { status: 500 })
  if (ids.length === 0) return Response.json({ error: 'No customers match this filter' }, { status: 400 })

  // Only one live list at a time — deactivate previous campaigns.
  await supabaseAdmin.from('wa_b_call_campaigns').update({ is_active: false }).eq('is_active', true)

  const { data: campaign, error: cErr } = await supabaseAdmin
    .from('wa_b_call_campaigns')
    .insert({ name: name.trim(), filter_json: f, created_by: user.id, is_active: true })
    .select('id')
    .single()
  if (cErr || !campaign) return Response.json({ error: cErr?.message ?? 'Create failed' }, { status: 500 })

  // Generate the cards (tasks) in chunks.
  const CHUNK = 500
  let taskCount = 0
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK).map(cid => ({ campaign_id: campaign.id, customer_id: cid }))
    const { error: tErr } = await supabaseAdmin
      .from('wa_b_call_tasks')
      .upsert(chunk, { onConflict: 'campaign_id,customer_id', ignoreDuplicates: true })
    if (tErr) return Response.json({ error: tErr.message }, { status: 500 })
    taskCount += chunk.length
  }

  return Response.json({ campaignId: campaign.id, taskCount })
}
