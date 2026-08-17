import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'

// Per-bill engagement report for the invoice ("Bill Summary") links — the invoice
// analog of the campaign funnel, but grained per BILL (a customer with two bills
// has two links). For each sent bill: who it went to, the exact URL, whether it
// delivered / was read (from wa_message_events, keyed by the outbound wamid),
// whether they reviewed (+ stars), and whether they submitted birthday / anniversary.
// `opened` + `visitedWebsite` are wired in a later instrumentation pass (NULL for now).
//   GET /api/invoices/report?limit=300
//
// Read-only, admin-gated (same session cookie as the rest of /admin).

export const dynamic = 'force-dynamic'

// Public Bill Summary base — derive from the publish URL, fall back to prod.
function pageBase(): string {
  const pub = process.env.CUSTOMER_APP_PUBLISH_URL || ''
  const stripped = pub.replace(/\/api\/.*$/, '')
  return stripped || 'https://gold.mnalankarpalace.com'
}

interface ReportRow {
  billNo: string; name: string | null; phone: string; url: string
  sentAt: string | null; delivered: boolean; read: boolean
  opened: boolean; reviewed: boolean; rating: number | null
  birthday: boolean; anniversary: boolean; visitedWebsite: boolean
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

  const limit = Math.min(1000, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') ?? '300') || 300))

  // Sent bills, newest first.
  const { data: invData, error } = await supabaseAdmin.from('wa_invoices')
    .select('bill_no, customer_name, phone, token, sent_at, wa_message_id, opened_at, reviewed_at, review_rating, birthday_submitted_at, anniversary_submitted_at, website_visited_at')
    .not('sent_at', 'is', null)
    .order('sent_at', { ascending: false })
    .limit(limit)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  const invoices = invData ?? []

  // delivered / read from the event timeline, keyed by the outbound wamid.
  const wamids = invoices.map(i => i.wa_message_id).filter(Boolean) as string[]
  const delivered = new Set<string>()
  const readSet = new Set<string>()
  for (let i = 0; i < wamids.length; i += 300) {
    const { data } = await supabaseAdmin.from('wa_message_events')
      .select('wa_message_id, status')
      .in('wa_message_id', wamids.slice(i, i + 300))
      .in('status', ['delivered', 'read'])
    for (const e of (data ?? []) as { wa_message_id: string; status: string }[]) {
      delivered.add(e.wa_message_id)                 // read implies delivered
      if (e.status === 'read') readSet.add(e.wa_message_id)
    }
  }

  const base = pageBase()
  const rows: ReportRow[] = invoices.map(i => {
    const wamid = i.wa_message_id as string | null
    return {
      billNo: i.bill_no as string,
      name: (i.customer_name as string) ?? null,
      phone: i.phone as string,
      url: `${base}/i/${i.token as string}`,
      sentAt: (i.sent_at as string) ?? null,
      delivered: wamid ? (delivered.has(wamid) || readSet.has(wamid)) : false,
      read: wamid ? readSet.has(wamid) : false,
      opened: !!i.opened_at,
      reviewed: !!i.reviewed_at,
      rating: (i.review_rating as number) ?? null,
      birthday: !!i.birthday_submitted_at,
      anniversary: !!i.anniversary_submitted_at,
      visitedWebsite: !!i.website_visited_at,
    }
  })

  const summary = {
    total: rows.length,
    delivered: rows.filter(r => r.delivered).length,
    read: rows.filter(r => r.read).length,
    opened: rows.filter(r => r.opened).length,
    reviewed: rows.filter(r => r.reviewed).length,
    birthday: rows.filter(r => r.birthday).length,
    anniversary: rows.filter(r => r.anniversary).length,
    visitedWebsite: rows.filter(r => r.visitedWebsite).length,
  }

  return Response.json({ summary, rows })
}
