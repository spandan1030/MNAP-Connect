import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'

// Customer Book — search/list the unified contact spine (all customers, chat +
// sales + calls), enriched with sales facts for the row summary.
//   GET /api/contacts?q=&limit=30&offset=0&filter=all|active|opted_out
// Search matches name (display or override) OR phone.

export async function GET(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const q = (sp.get('q') ?? '').trim()
  const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') ?? '30') || 30))
  const offset = Math.max(0, parseInt(sp.get('offset') ?? '0') || 0)
  const filter = sp.get('filter') ?? 'all'

  let query = supabaseAdmin
    .from('contacts')
    .select('id, phone, name, name_override, from_chat, from_sales, is_opted_out, wa_b_customer_id', { count: 'exact' })

  if (filter === 'active')     query = query.eq('is_opted_out', false)
  if (filter === 'opted_out')  query = query.eq('is_opted_out', true)

  if (q) {
    const digits = q.replace(/\D/g, '')
    const ors = [`name.ilike.%${q}%`, `name_override.ilike.%${q}%`]
    if (digits.length >= 3) ors.push(`phone.ilike.%${digits}%`)
    query = query.or(ors.join(','))
  }

  // Newest-first by created_at gives a stable, useful default order.
  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as Array<{
    id: string; phone: string; name: string | null; name_override: string | null
    from_chat: boolean; from_sales: boolean; is_opted_out: boolean; wa_b_customer_id: string | null
  }>

  // Enrich with sales facts (value tier + last purchase) for the page's rows.
  const bIds = rows.map(r => r.wa_b_customer_id).filter((x): x is string => !!x)
  const markerByCust = new Map<string, { value_tier: string | null; recency_tier: string | null; last_purchase_date: string | null; lifetime_value: number | null }>()
  for (let i = 0; i < bIds.length; i += 300) {
    const { data: mk } = await supabaseAdmin
      .from('wa_b_markers')
      .select('customer_id, value_tier, recency_tier, last_purchase_date, lifetime_value')
      .in('customer_id', bIds.slice(i, i + 300))
    for (const m of (mk ?? []) as Array<{ customer_id: string; value_tier: string | null; recency_tier: string | null; last_purchase_date: string | null; lifetime_value: number | null }>) {
      markerByCust.set(m.customer_id, m)
    }
  }

  const contacts = rows.map(r => {
    const mk = r.wa_b_customer_id ? markerByCust.get(r.wa_b_customer_id) : null
    return {
      id: r.id,
      phone: r.phone,
      name: r.name_override || r.name || 'Unknown',
      fromChat: r.from_chat,
      fromSales: r.from_sales,
      isOptedOut: r.is_opted_out,
      valueTier: mk?.value_tier ?? null,
      recencyTier: mk?.recency_tier ?? null,
      lastPurchase: mk?.last_purchase_date ?? null,
      lifetimeValue: mk?.lifetime_value ?? null,
    }
  })

  return Response.json({ total: count ?? contacts.length, contacts })
}
