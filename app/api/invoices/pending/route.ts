import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'

// Invoices imported but not yet sent — the queue the invoice-link send draws from.
// Each row is decorated with the unified opt-out flag so the UI can grey out
// anyone who can't be messaged. Newest bills first. Optional `days` keeps only
// bills dated within the last N days (thank buyers from the last N days only).
//   GET /api/invoices/pending?limit=200&days=14

function tenDigit(raw: string): string {
  const d = (raw ?? '').replace(/\D/g, '')
  return d.length > 10 && d.startsWith('91') ? d.slice(-10) : d
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

  const limit = Math.max(1, Math.min(1000, parseInt(req.nextUrl.searchParams.get('limit') ?? '200') || 200))
  const daysRaw = req.nextUrl.searchParams.get('days')
  // `days=all` (or missing) ⇒ no recency window — needed to surface historical bills.
  const days = (daysRaw && daysRaw !== 'all')
    ? Math.max(1, Math.min(365, parseInt(daysRaw) || 14))
    : null

  let q = supabaseAdmin
    .from('wa_invoices')
    .select('id, bill_no, phone, customer_name, invoice_date, payable, net_amount')
    .is('sent_at', null)
  if (days) {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days)
    q = q.gte('invoice_date', cutoff.toLocaleDateString('en-CA'))  // YYYY-MM-DD
  }
  const { data, error } = await q
    .order('invoice_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const invoices = (data ?? []) as Array<{
    id: string; bill_no: string; phone: string; customer_name: string | null
    invoice_date: string | null; payable: number | null; net_amount: number | null
  }>

  // Opted out — the one flag from the contact spine (chat STOP ∪ call DNC ∪ manual).
  const phones = [...new Set(invoices.map(i => tenDigit(i.phone)))]
  const optedOut = new Set<string>()
  for (let i = 0; i < phones.length; i += 300) {
    const { data: c } = await supabaseAdmin.from('contacts').select('phone')
      .eq('is_opted_out', true).in('phone', phones.slice(i, i + 300))
    for (const r of (c ?? []) as { phone: string }[]) optedOut.add(tenDigit(r.phone))
  }

  const rows = invoices.map(i => ({
    id: i.id,
    billNo: i.bill_no,
    phone: tenDigit(i.phone),
    name: i.customer_name,
    date: i.invoice_date,
    payable: i.payable ?? i.net_amount,
    optedOut: optedOut.has(tenDigit(i.phone)),
  }))

  return Response.json({ total: rows.length, invoices: rows })
}
