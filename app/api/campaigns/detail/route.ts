import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'

// Campaign funnel: sent -> delivered -> read -> replied -> converted (purchase
// within 90 days of the send). Works for both a Reach run (wa_campaigns +
// wa_send_ledger.campaign_id) and a legacy broadcast (wa_messages.broadcast_id).
//   GET /api/campaigns/detail?id=<uuid>&source=reach|broadcast

const CONV_DAYS = 90

function tenDigit(raw: string): string {
  const d = (raw ?? '').replace(/\D/g, '')
  return d.length > 10 && d.startsWith('91') ? d.slice(-10) : d
}
function addDays(iso: string, days: number): string {
  const d = new Date(iso); d.setDate(d.getDate() + days); return d.toISOString()
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

  const id = req.nextUrl.searchParams.get('id')
  const source = req.nextUrl.searchParams.get('source') === 'broadcast' ? 'broadcast' : 'reach'
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })

  // ── Gather the "sent" set: wa_message_ids + phones + the send timestamp ─────
  const wamids: string[] = []
  const phones = new Set<string>()
  let sinceISO = new Date().toISOString()
  let label = 'Campaign', template: string | null = null, failed = 0

  if (source === 'reach') {
    const { data: camp } = await supabaseAdmin.from('wa_campaigns')
      .select('cohort_label, template_name, created_at, failed').eq('id', id).maybeSingle()
    if (!camp) return Response.json({ error: 'Campaign not found' }, { status: 404 })
    label = (camp.cohort_label as string) || 'Reach send'
    template = (camp.template_name as string) ?? null
    sinceISO = camp.created_at as string
    failed = (camp.failed as number) ?? 0
    for (let from = 0; ; from += 1000) {
      const { data } = await supabaseAdmin.from('wa_send_ledger')
        .select('phone, wa_message_id').eq('campaign_id', id).eq('status', 'sent').range(from, from + 999)
      const rows = (data ?? []) as { phone: string; wa_message_id: string | null }[]
      for (const r of rows) { phones.add(tenDigit(r.phone)); if (r.wa_message_id) wamids.push(r.wa_message_id) }
      if (rows.length < 1000) break
    }
  } else {
    const { data: bc } = await supabaseAdmin.from('wa_broadcasts')
      .select('topic_name, template_name, created_at, failed').eq('id', id).maybeSingle()
    if (!bc) return Response.json({ error: 'Broadcast not found' }, { status: 404 })
    label = (bc.topic_name as string) ? `Broadcast · ${bc.topic_name as string}` : 'Broadcast (legacy)'
    template = (bc.template_name as string) ?? null
    sinceISO = bc.created_at as string
    failed = (bc.failed as number) ?? 0
    // Outbound messages of this broadcast → wamids + phones (via thread).
    const threadIds = new Set<string>()
    for (let from = 0; ; from += 1000) {
      const { data } = await supabaseAdmin.from('wa_messages')
        .select('wa_message_id, thread_id').eq('broadcast_id', id).eq('direction', 'outbound').range(from, from + 999)
      const rows = (data ?? []) as { wa_message_id: string | null; thread_id: string | null }[]
      for (const r of rows) { if (r.wa_message_id) wamids.push(r.wa_message_id); if (r.thread_id) threadIds.add(r.thread_id) }
      if (rows.length < 1000) break
    }
    const tids = [...threadIds]
    for (let i = 0; i < tids.length; i += 300) {
      const { data } = await supabaseAdmin.from('wa_threads').select('phone').in('id', tids.slice(i, i + 300))
      for (const r of (data ?? []) as { phone: string }[]) phones.add(tenDigit(r.phone))
    }
  }

  const sent = source === 'reach' ? phones.size : wamids.length

  // ── delivered / read from wa_message_events ─────────────────────────────────
  const delivered = new Set<string>(), read = new Set<string>()
  for (let i = 0; i < wamids.length; i += 300) {
    const { data } = await supabaseAdmin.from('wa_message_events')
      .select('wa_message_id, status').in('wa_message_id', wamids.slice(i, i + 300))
      .in('status', ['delivered', 'read'])
    for (const e of (data ?? []) as { wa_message_id: string; status: string }[]) {
      delivered.add(e.wa_message_id)                       // read implies delivered
      if (e.status === 'read') read.add(e.wa_message_id)
    }
  }

  // ── replied: inbound messages from these phones after the send ──────────────
  const phoneList = [...phones]
  const repliedThreads = new Set<string>()
  const threadToPhone = new Map<string, string>()
  for (let i = 0; i < phoneList.length; i += 300) {
    const { data } = await supabaseAdmin.from('wa_threads').select('id, phone').in('phone', phoneList.slice(i, i + 300))
    for (const t of (data ?? []) as { id: string; phone: string }[]) threadToPhone.set(t.id, tenDigit(t.phone))
  }
  const allThreadIds = [...threadToPhone.keys()]
  for (let i = 0; i < allThreadIds.length; i += 200) {
    const { data } = await supabaseAdmin.from('wa_messages')
      .select('thread_id').eq('direction', 'inbound').gte('created_at', sinceISO)
      .in('thread_id', allThreadIds.slice(i, i + 200))
    for (const m of (data ?? []) as { thread_id: string }[]) repliedThreads.add(m.thread_id)
  }
  const replied = repliedThreads.size

  // ── converted: last purchase within 90 days AFTER the send ──────────────────
  const untilISO = addDays(sinceISO, CONV_DAYS)
  const sinceDate = sinceISO.slice(0, 10), untilDate = untilISO.slice(0, 10)
  const converters = new Set<string>()
  // phone -> wa_b_customer_id via contacts, then markers last_purchase_date.
  const bIdToPhone = new Map<string, string>()
  for (let i = 0; i < phoneList.length; i += 300) {
    const { data } = await supabaseAdmin.from('contacts')
      .select('phone, wa_b_customer_id').in('phone', phoneList.slice(i, i + 300))
    for (const c of (data ?? []) as { phone: string; wa_b_customer_id: string | null }[]) {
      if (c.wa_b_customer_id) bIdToPhone.set(c.wa_b_customer_id, tenDigit(c.phone))
    }
  }
  const bIds = [...bIdToPhone.keys()]
  for (let i = 0; i < bIds.length; i += 300) {
    const { data } = await supabaseAdmin.from('wa_b_markers')
      .select('customer_id, last_purchase_date').in('customer_id', bIds.slice(i, i + 300))
      .gte('last_purchase_date', sinceDate).lte('last_purchase_date', untilDate)
    for (const m of (data ?? []) as { customer_id: string; last_purchase_date: string | null }[]) {
      const ph = bIdToPhone.get(m.customer_id); if (ph) converters.add(ph)
    }
  }

  return Response.json({
    id, source, label, template, sentAt: sinceISO, convWindowDays: CONV_DAYS,
    funnel: { sent, delivered: delivered.size, read: read.size, replied, converted: converters.size, failed },
  })
}
