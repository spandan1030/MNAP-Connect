import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'

// Feedback CSV: one row per phone = profile markers + call-level aggregates.
// Feeds back into the customer-signals pipeline to compute call-level markers.
//   GET /api/calls/export            -> all sales-imported customers
//   GET /api/calls/export?campaign=  -> only that campaign's customers

const MARKER_COLS = [
  'recency_tier', 'value_tier', 'rfm_segment', 'frequency_tier',
  'lifetime_value', 'total_bills', 'days_since_last_purchase',
  'is_high_value', 'is_likely_wedding', 'primary_metal', 'outreach_bucket',
]

function csvCell(v: unknown): string {
  if (v == null) return ''
  const s = Array.isArray(v) ? v.join('; ') : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data } = await build(from, from + PAGE - 1)
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

export async function GET(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const campaignId = req.nextUrl.searchParams.get('campaign')

  // Restrict to a campaign's customers if asked.
  let restrictIds: Set<string> | null = null
  if (campaignId) {
    const tasks = await fetchAll<{ customer_id: string }>((f, t) =>
      supabaseAdmin.from('wa_b_call_tasks').select('customer_id').eq('campaign_id', campaignId).range(f, t))
    restrictIds = new Set(tasks.map(t => t.customer_id))
  }

  // Customers (sales-imported).
  const customers = await fetchAll<{ id: string; name: string; phone: string; is_do_not_call: boolean; is_hot_lead: boolean }>((f, t) =>
    supabaseAdmin.from('wa_b_customers').select('id,name,phone,is_do_not_call,is_hot_lead').eq('source', 'sales_import').range(f, t))
  const custList = restrictIds ? customers.filter(c => restrictIds!.has(c.id)) : customers
  const idSet = new Set(custList.map(c => c.id))

  // Markers.
  const markers = await fetchAll<Record<string, unknown>>((f, t) =>
    supabaseAdmin.from('wa_b_markers').select('*').range(f, t) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null }>)
  const markerBy = new Map<string, Record<string, unknown>>(markers.map(m => [m.customer_id as string, m]))

  // Call logs → aggregate per customer.
  const logs = await fetchAll<{ customer_id: string; success: boolean | null; topics: string[] | null; intent: string | null; called_at: string; outcome_at: string | null }>((f, t) =>
    supabaseAdmin.from('wa_b_call_logs').select('customer_id,success,topics,intent,called_at,outcome_at').range(f, t))

  interface Agg { attempts: number; successes: number; last_call: string; last_intent: string | null; topics: Set<string> }
  const aggBy = new Map<string, Agg>()
  for (const l of logs) {
    if (!idSet.has(l.customer_id)) continue
    let a = aggBy.get(l.customer_id)
    if (!a) { a = { attempts: 0, successes: 0, last_call: '', last_intent: null, topics: new Set() }; aggBy.set(l.customer_id, a) }
    a.attempts++
    if (l.called_at > a.last_call) { a.last_call = l.called_at; if (l.intent) a.last_intent = l.intent }
    if (l.success) { a.successes++; (l.topics ?? []).forEach(x => a!.topics.add(x)) }
  }

  const header = [
    'phone', 'name', ...MARKER_COLS, 'audience_labels',
    'call_attempts', 'call_successes', 'reached', 'unreachable',
    'last_call_date', 'last_intent',
    'topic_rate', 'topic_designs', 'topic_offers', 'topic_booking',
    'is_do_not_call', 'is_hot_lead',
  ]
  const lines = [header.join(',')]
  for (const c of custList) {
    const m = markerBy.get(c.id) ?? {}
    const a = aggBy.get(c.id)
    const attempts = a?.attempts ?? 0
    const successes = a?.successes ?? 0
    const row = [
      c.phone, c.name,
      ...MARKER_COLS.map(col => csvCell(m[col])),
      csvCell(m.audience_labels),
      attempts, successes,
      successes > 0 ? 'true' : 'false',
      attempts > 0 && successes === 0 ? 'true' : 'false',
      a?.last_call ? a.last_call.slice(0, 10) : '',
      a?.last_intent ?? '',
      a?.topics.has('rate') ? 'true' : 'false',
      a?.topics.has('designs') ? 'true' : 'false',
      a?.topics.has('offers') ? 'true' : 'false',
      a?.topics.has('booking') ? 'true' : 'false',
      c.is_do_not_call ? 'true' : 'false',
      c.is_hot_lead ? 'true' : 'false',
    ].map(csvCell)
    lines.push(row.join(','))
  }

  const csv = lines.join('\n')
  const stamp = new Date().toISOString().slice(0, 10)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="call_feedback_${stamp}.csv"`,
    },
  })
}
