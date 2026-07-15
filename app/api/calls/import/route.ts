import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { SALES_CATEGORY_TO_INTEREST, METALS } from '@/lib/signals'

// Bulk-import one BATCH of leads (from customer-signals leads_import.csv).
// Client parses the CSV and POSTs rows in chunks. This route:
//   1. inserts NEW customers by phone (never clobbers existing enrollment rows)
//   2. upserts their marker snapshot into wa_b_markers (refreshes in place)
// Existing customers' source / DNC / phone are preserved.

interface RawRow {
  phone?: string
  name?: string
  recency_tier?: string
  value_tier?: string
  rfm_segment?: string
  frequency_tier?: string
  lifetime_value?: string
  total_bills?: string
  days_since_last_purchase?: string
  first_purchase_date?: string
  last_purchase_date?: string
  is_high_value?: string
  is_likely_wedding?: string
  primary_metal?: string
  outreach_bucket?: string
  audience_labels?: string
  markers_json?: string
}

function normPhone(raw: string | undefined): string | null {
  const d = (raw ?? '').replace(/\D/g, '')
  const ten = d.length > 10 && d.startsWith('91') ? d.slice(-10) : d
  return ten.length === 10 && '6789'.includes(ten[0]) ? ten : null
}
function num(v: string | undefined): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
function int(v: string | undefined): number | null {
  const n = num(v)
  return n == null ? null : Math.round(n)
}
function bool(v: string | undefined): boolean {
  return v === 'true' || v === 'True' || v === '1' || v === 'yes'
}
function labels(v: string | undefined): string[] {
  return (v ?? '').split(';').map(s => s.trim()).filter(Boolean)
}
function parseMarkers(v: string | undefined): Record<string, unknown> | null {
  if (!v) return null
  try { return JSON.parse(v) } catch { return null }
}
function dateOnly(v: string | undefined): string | null {
  const s = (v ?? '').trim()
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
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

  const { rows, batch } = (await req.json()) as { rows: RawRow[]; batch?: string }
  if (!Array.isArray(rows) || rows.length === 0) {
    return Response.json({ error: 'No rows' }, { status: 400 })
  }

  // De-dupe within the batch, keep only valid phones.
  const byPhone = new Map<string, RawRow>()
  for (const r of rows) {
    const p = normPhone(r.phone)
    if (p) byPhone.set(p, r)
  }
  const phones = [...byPhone.keys()]
  if (phones.length === 0) return Response.json({ customers: 0, markers: 0, skipped: rows.length })

  // 1. Insert new customers only (ignoreDuplicates keeps existing rows intact).
  const custRows = phones.map(p => ({
    name: (byPhone.get(p)!.name ?? '').trim() || 'Unknown',
    phone: p,
    source: 'sales_import',
    enrolled_by: user.id,
  }))
  const { error: custErr } = await supabaseAdmin
    .from('wa_b_customers')
    .upsert(custRows, { onConflict: 'phone', ignoreDuplicates: true })
  if (custErr) return Response.json({ error: custErr.message }, { status: 500 })

  // 2. Resolve phone -> id for the whole batch (new + pre-existing).
  const { data: custs, error: selErr } = await supabaseAdmin
    .from('wa_b_customers')
    .select('id, phone')
    .in('phone', phones)
  if (selErr) return Response.json({ error: selErr.message }, { status: 500 })
  const idByPhone = new Map<string, string>((custs ?? []).map(c => [c.phone, c.id]))

  // 3. Upsert marker snapshots (refresh in place by customer_id).
  const markerRows = phones
    .map(p => {
      const id = idByPhone.get(p)
      if (!id) return null
      const r = byPhone.get(p)!
      return {
        customer_id: id,
        recency_tier: r.recency_tier ?? null,
        value_tier: r.value_tier ?? null,
        rfm_segment: r.rfm_segment ?? null,
        frequency_tier: r.frequency_tier ?? null,
        audience_labels: labels(r.audience_labels),
        lifetime_value: num(r.lifetime_value),
        total_bills: int(r.total_bills),
        days_since_last_purchase: int(r.days_since_last_purchase),
        first_purchase_date: dateOnly(r.first_purchase_date),
        last_purchase_date: dateOnly(r.last_purchase_date),
        is_high_value: bool(r.is_high_value),
        is_likely_wedding: bool(r.is_likely_wedding),
        primary_metal: r.primary_metal ?? null,
        outreach_bucket: r.outreach_bucket ?? null,
        markers: parseMarkers(r.markers_json),
        import_batch: batch ?? null,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  const { error: mErr } = await supabaseAdmin
    .from('wa_b_markers')
    .upsert(markerRows, { onConflict: 'customer_id' })
  if (mErr) return Response.json({ error: mErr.message }, { status: 500 })

  // 4. Derive sales-source interest signals (product + metal affinity) into
  //    the unified wa_signals layer. Phone-keyed, refreshed in place.
  const now = new Date().toISOString()
  const sigRows: { phone: string; interest: string; source: string; weight: number; evidence: string; last_seen: string }[] = []
  for (const p of phones) {
    const blob = parseMarkers(byPhone.get(p)!.markers_json) ?? {}
    const seen = new Set<string>()
    const push = (interest: string, evidence: string) => {
      if (seen.has(interest)) return
      seen.add(interest)
      sigRows.push({ phone: p, interest, source: 'sales', weight: 1, evidence, last_seen: now })
    }
    for (const [cat, interest] of Object.entries(SALES_CATEGORY_TO_INTEREST)) {
      if (blob[`bought_${cat}`] === true) push(interest, 'bought')
    }
    for (const metal of METALS) {
      if (blob[`buys_${metal}`] === true) push(metal, 'buys')
    }
    const pm = byPhone.get(p)!.primary_metal
    if (pm && (METALS as readonly string[]).includes(pm)) push(pm, 'primary metal')
  }
  if (sigRows.length) {
    const { error: sErr } = await supabaseAdmin
      .from('wa_signals')
      .upsert(sigRows, { onConflict: 'phone,interest,source' })
    if (sErr) return Response.json({ error: sErr.message }, { status: 500 })
  }

  return Response.json({ customers: phones.length, markers: markerRows.length, signals: sigRows.length })
}
