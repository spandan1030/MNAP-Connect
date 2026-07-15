import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  CALL_TOPIC_TO_INTEREST,
  SALES_CATEGORY_TO_INTEREST, METALS, type SignalSource,
} from '@/lib/signals'

// Rebuild the unified wa_signals layer from every existing source.
// Idempotent: upserts by (phone, interest, source), recomputing weight.
//   POST /api/signals/sync            -> sync all sources
//   POST { sources: ['whatsapp'] }    -> sync a subset
// Phone is the join key across the Type A / Type B customer split.

function tenDigit(raw: string | null | undefined): string | null {
  const d = (raw ?? '').replace(/\D/g, '')
  const ten = d.length > 10 && d.startsWith('91') ? d.slice(-10) : d
  return ten.length === 10 ? ten : null
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

interface Sig { phone: string; interest: string; source: SignalSource; weight: number; evidence: string | null; last_seen: string }

// Accumulate one piece of evidence into the map (dedupe by phone|interest|source).
function add(map: Map<string, Sig>, phone: string | null, interest: string | null, source: SignalSource, evidence: string, ts?: string | null) {
  if (!phone || !interest) return
  const key = `${phone}|${interest}|${source}`
  const seen = ts ?? new Date().toISOString()
  const cur = map.get(key)
  if (cur) {
    cur.weight += 1
    if (seen > cur.last_seen) cur.last_seen = seen
    if (cur.evidence && evidence && !cur.evidence.includes(evidence)) cur.evidence = `${cur.evidence}, ${evidence}`
  } else {
    map.set(key, { phone, interest, source, weight: 1, evidence: evidence || null, last_seen: seen })
  }
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

  const body = (await req.json().catch(() => ({}))) as { sources?: SignalSource[] }
  const want = new Set<SignalSource>(body.sources ?? ['sales', 'whatsapp', 'call'])

  const map = new Map<string, Sig>()

  // Topic id -> canonical key + name (wa_033). Interpretation is the topic's
  // own key — no label guessing.
  const topics = await fetchAll<{ id: string; name: string; key: string | null }>((f, t) =>
    supabaseAdmin.from('wa_interest_topics').select('id,name,key').range(f, t))
  const topicName = new Map(topics.map(t => [t.id, t.name]))
  const topicKey  = new Map(topics.map(t => [t.id, t.key]))

  // ── WhatsApp: interests + lead captures (Type A, phone via wa_customers) ──
  if (want.has('whatsapp')) {
    const aCust = await fetchAll<{ id: string; phone: string }>((f, t) =>
      supabaseAdmin.from('wa_customers').select('id,phone').range(f, t))
    const aPhone = new Map(aCust.map(c => [c.id, tenDigit(c.phone)]))

    const interests = await fetchAll<{ customer_id: string; topic_id: string; created_at: string | null }>((f, t) =>
      supabaseAdmin.from('wa_customer_interests').select('customer_id,topic_id,created_at').range(f, t))
    for (const r of interests) {
      const name = topicName.get(r.topic_id)
      add(map, aPhone.get(r.customer_id) ?? null, topicKey.get(r.topic_id) ?? null, 'whatsapp', name ?? 'topic', r.created_at)
    }

    const leads = await fetchAll<{ customer_id: string | null; metal: string | null; product_topic_id: string | null; wants_designs: boolean | null; created_at: string | null }>((f, t) =>
      supabaseAdmin.from('wa_lead_captures').select('customer_id,metal,product_topic_id,wants_designs,created_at').range(f, t))
    for (const l of leads) {
      const phone = l.customer_id ? (aPhone.get(l.customer_id) ?? null) : null
      if (l.metal && METALS.includes(l.metal as typeof METALS[number])) add(map, phone, l.metal, 'whatsapp', 'lead: metal', l.created_at)
      if (l.product_topic_id) add(map, phone, topicKey.get(l.product_topic_id) ?? null, 'whatsapp', 'lead: product', l.created_at)
      if (l.wants_designs) add(map, phone, 'designs', 'whatsapp', 'lead: wants designs', l.created_at)
    }
  }

  // Type B customer id -> phone (calls + markers).
  let bPhone: Map<string, string | null> | null = null
  async function loadBPhone() {
    if (bPhone) return bPhone
    const bCust = await fetchAll<{ id: string; phone: string }>((f, t) =>
      supabaseAdmin.from('wa_b_customers').select('id,phone').range(f, t))
    bPhone = new Map(bCust.map(c => [c.id, tenDigit(c.phone)]))
    return bPhone
  }

  // ── Calls: successful call topics (Type B) ──
  if (want.has('call')) {
    const bp = await loadBPhone()
    const logs = await fetchAll<{ customer_id: string; success: boolean | null; topics: string[] | null; called_at: string | null }>((f, t) =>
      supabaseAdmin.from('wa_b_call_logs').select('customer_id,success,topics,called_at').range(f, t))
    for (const l of logs) {
      if (!l.success) continue
      const phone = bp.get(l.customer_id) ?? null
      for (const tp of l.topics ?? []) add(map, phone, CALL_TOPIC_TO_INTEREST[tp] ?? null, 'call', `call: ${tp}`, l.called_at)
    }
  }

  // ── Sales: product/metal affinity from marker snapshot (Type B) ──
  if (want.has('sales')) {
    const bp = await loadBPhone()
    const markers = await fetchAll<{ customer_id: string; primary_metal: string | null; markers: Record<string, unknown> | null; imported_at: string | null }>((f, t) =>
      supabaseAdmin.from('wa_b_markers').select('customer_id,primary_metal,markers,imported_at').range(f, t))
    for (const m of markers) {
      const phone = bp.get(m.customer_id) ?? null
      const blob = m.markers ?? {}
      // product categories: bought_<cat> === true
      for (const [cat, interest] of Object.entries(SALES_CATEGORY_TO_INTEREST)) {
        if (blob[`bought_${cat}`] === true) add(map, phone, interest, 'sales', 'bought', m.imported_at)
      }
      // metals: buys_<metal> === true, plus primary_metal
      for (const metal of METALS) {
        if (blob[`buys_${metal}`] === true) add(map, phone, metal, 'sales', 'buys', m.imported_at)
      }
      if (m.primary_metal && METALS.includes(m.primary_metal as typeof METALS[number]))
        add(map, phone, m.primary_metal, 'sales', 'primary metal', m.imported_at)
    }
  }

  // ── Upsert into wa_signals ──
  const rows = [...map.values()]
  const CHUNK = 500
  let written = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabaseAdmin
      .from('wa_signals')
      .upsert(rows.slice(i, i + CHUNK), { onConflict: 'phone,interest,source' })
    if (error) return Response.json({ error: error.message, written }, { status: 500 })
    written += Math.min(CHUNK, rows.length - i)
  }

  return Response.json({ written, sources: [...want] })
}
