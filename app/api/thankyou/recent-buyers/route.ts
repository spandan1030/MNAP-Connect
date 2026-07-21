import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'

// Recent-buyers thank-you: everyone whose LAST purchase is within `days`
// (default 14), straight from wa_b_markers — no file upload. Each row is
// decorated with whether the chosen thank-you template is already suppressed
// (sent within its window) so we never pay to thank the same buyer twice.
//   GET /api/thankyou/recent-buyers?days=14&templateId=<uuid>

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

  const days = Math.max(1, Math.min(90, parseInt(req.nextUrl.searchParams.get('days') ?? '14') || 14))
  const templateId = req.nextUrl.searchParams.get('templateId')

  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = cutoff.toLocaleDateString('en-CA')

  // Buyers with a recent last purchase. Opt-out is applied ONCE below, from the
  // unified flag — not here, so no per-channel column is consulted.
  const rows: Array<{ phone: string; name: string | null; last: string | null }> = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('wa_b_markers')
      .select('last_purchase_date, wa_b_customers!inner(phone, name)')
      .gte('last_purchase_date', cutoffStr)
      .order('last_purchase_date', { ascending: false })
      .range(from, from + PAGE - 1)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    const page = (data ?? []) as unknown as Array<{ last_purchase_date: string | null; wa_b_customers: { phone: string; name: string | null } | { phone: string; name: string | null }[] }>
    for (const r of page) {
      const c = Array.isArray(r.wa_b_customers) ? r.wa_b_customers[0] : r.wa_b_customers
      if (!c) continue
      rows.push({ phone: tenDigit(c.phone), name: c.name, last: r.last_purchase_date })
    }
    if (page.length < PAGE) break
  }

  // De-dupe by phone (keep the most recent).
  const byPhone = new Map<string, { phone: string; name: string | null; last: string | null }>()
  for (const r of rows) if (!byPhone.has(r.phone)) byPhone.set(r.phone, r)
  const phones = [...byPhone.keys()]

  // Suppression against the chosen thank-you template.
  const suppSet = new Set<string>()
  if (templateId && phones.length) {
    const { data: tpl } = await supabaseAdmin.from('wa_message_templates')
      .select('id, suppression_bucket, suppression_days').eq('id', templateId).maybeSingle()
    const key = tpl?.suppression_bucket || tpl?.id
    const sd = tpl?.suppression_days ?? 0
    if (key && sd > 0) {
      const supCut = new Date(); supCut.setDate(supCut.getDate() - sd)
      for (let i = 0; i < phones.length; i += 300) {
        const { data } = await supabaseAdmin.from('wa_send_ledger').select('phone')
          .in('phone', phones.slice(i, i + 300)).eq('status', 'sent')
          .eq('suppression_key', key).gte('sent_at', supCut.toISOString())
        for (const r of (data ?? []) as { phone: string }[]) suppSet.add(tenDigit(r.phone))
      }
    }
  }

  // Opted out — THE one flag from the contact spine (chat STOP ∪ call DNC ∪ manual).
  const optedOutSet = new Set<string>()
  for (let i = 0; i < phones.length; i += 300) {
    const { data } = await supabaseAdmin.from('contacts').select('phone').eq('is_opted_out', true).in('phone', phones.slice(i, i + 300))
    for (const r of (data ?? []) as { phone: string }[]) optedOutSet.add(tenDigit(r.phone))
  }

  const recipients = phones.map(p => {
    const r = byPhone.get(p)!
    return { phone: p, name: r.name, lastPurchase: r.last, suppressed: suppSet.has(p), optedOut: optedOutSet.has(p) }
  })

  return Response.json({ days, total: recipients.length, recipients })
}
