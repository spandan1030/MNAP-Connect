import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'

// Campaign detail: the funnel summary PLUS a per-recipient breakdown —
// for every number in the campaign, what happened to its message
// (sent → delivered → read → replied → converted), and the failure reason if
// it never sent. Works for a Reach run (wa_campaigns + wa_send_ledger.campaign_id)
// and a legacy broadcast (wa_messages.broadcast_id).
//   GET /api/campaigns/detail?id=<uuid>&source=reach|broadcast

const CONV_DAYS = 90

function tenDigit(raw: string): string {
  const d = (raw ?? '').replace(/\D/g, '')
  return d.length > 10 && d.startsWith('91') ? d.slice(-10) : d
}
function addDays(iso: string, days: number): string {
  const d = new Date(iso); d.setDate(d.getDate() + days); return d.toISOString()
}

interface Recip {
  phone: string; name: string | null; status: string   // 'sent' | 'failed'
  wamid: string | null; error: string | null
  delivered: boolean; read: boolean; replied: boolean; converted: boolean
}

// The furthest stage a recipient reached — drives the row's status label.
function stage(r: Recip): string {
  if (r.status === 'failed') return 'failed'
  if (r.converted) return 'converted'
  if (r.replied) return 'replied'
  if (r.read) return 'read'
  if (r.delivered) return 'delivered'
  return 'sent'
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

  // phone -> recipient row (one per number). wamid -> phone lets us attribute
  // delivered/read receipts (which are keyed by message id) back to a person.
  const byPhone = new Map<string, Recip>()
  const wamidToPhone = new Map<string, string>()
  let sinceISO = new Date().toISOString()
  let label = 'Campaign', template: string | null = null

  if (source === 'reach') {
    const { data: camp } = await supabaseAdmin.from('wa_campaigns')
      .select('cohort_label, template_name, created_at').eq('id', id).maybeSingle()
    if (!camp) return Response.json({ error: 'Campaign not found' }, { status: 404 })
    label = (camp.cohort_label as string) || 'Reach send'
    template = (camp.template_name as string) ?? null
    sinceISO = camp.created_at as string
    for (let from = 0; ; from += 1000) {
      const { data } = await supabaseAdmin.from('wa_send_ledger')
        .select('phone, wa_message_id, status, error').eq('campaign_id', id).range(from, from + 999)
      const rows = (data ?? []) as { phone: string; wa_message_id: string | null; status: string; error: string | null }[]
      for (const r of rows) {
        const p = tenDigit(r.phone)
        // Prefer a 'sent' row over a 'failed' one if a phone somehow has both.
        const prev = byPhone.get(p)
        if (prev && prev.status === 'sent') { /* keep */ } else {
          byPhone.set(p, { phone: p, name: null, status: r.status === 'sent' ? 'sent' : 'failed',
            wamid: r.wa_message_id ?? null, error: r.error ?? null,
            delivered: false, read: false, replied: false, converted: false })
        }
        if (r.wa_message_id) wamidToPhone.set(r.wa_message_id, p)
      }
      if (rows.length < 1000) break
    }
  } else {
    const { data: bc } = await supabaseAdmin.from('wa_broadcasts')
      .select('topic_name, template_name, created_at').eq('id', id).maybeSingle()
    if (!bc) return Response.json({ error: 'Broadcast not found' }, { status: 404 })
    label = (bc.topic_name as string) ? `Broadcast · ${bc.topic_name as string}` : 'Broadcast (legacy)'
    template = (bc.template_name as string) ?? null
    sinceISO = bc.created_at as string
    const threadToPhone = new Map<string, string>()
    const rowsByThread: Array<{ wa_message_id: string | null; thread_id: string | null; status: string; failed_reason: string | null }> = []
    for (let from = 0; ; from += 1000) {
      const { data } = await supabaseAdmin.from('wa_messages')
        .select('wa_message_id, thread_id, status, failed_reason').eq('broadcast_id', id).eq('direction', 'outbound').range(from, from + 999)
      const rows = (data ?? []) as { wa_message_id: string | null; thread_id: string | null; status: string; failed_reason: string | null }[]
      rowsByThread.push(...rows)
      if (rows.length < 1000) break
    }
    const tids = [...new Set(rowsByThread.map(r => r.thread_id).filter(Boolean) as string[])]
    for (let i = 0; i < tids.length; i += 300) {
      const { data } = await supabaseAdmin.from('wa_threads').select('id, phone').in('id', tids.slice(i, i + 300))
      for (const r of (data ?? []) as { id: string; phone: string }[]) threadToPhone.set(r.id, tenDigit(r.phone))
    }
    for (const r of rowsByThread) {
      const p = r.thread_id ? threadToPhone.get(r.thread_id) : undefined
      if (!p) continue
      const failed = r.status === 'failed'
      byPhone.set(p, { phone: p, name: null, status: failed ? 'failed' : 'sent', wamid: r.wa_message_id ?? null,
        error: r.failed_reason ?? null, delivered: false, read: false, replied: false, converted: false })
      if (r.wa_message_id) wamidToPhone.set(r.wa_message_id, p)
    }
  }

  const wamids = [...wamidToPhone.keys()]
  const phoneList = [...byPhone.keys()]

  // ── delivered / read from wa_message_events (attribute to phone) ────────────
  for (let i = 0; i < wamids.length; i += 300) {
    const { data } = await supabaseAdmin.from('wa_message_events')
      .select('wa_message_id, status').in('wa_message_id', wamids.slice(i, i + 300))
      .in('status', ['delivered', 'read'])
    for (const e of (data ?? []) as { wa_message_id: string; status: string }[]) {
      const p = wamidToPhone.get(e.wa_message_id); if (!p) continue
      const rec = byPhone.get(p); if (!rec) continue
      rec.delivered = true                       // read implies delivered
      if (e.status === 'read') rec.read = true
    }
  }

  // ── names + display from contacts ───────────────────────────────────────────
  const bIdToPhone = new Map<string, string>()
  for (let i = 0; i < phoneList.length; i += 300) {
    const { data } = await supabaseAdmin.from('contacts')
      .select('phone, name, name_override, wa_b_customer_id').in('phone', phoneList.slice(i, i + 300))
    for (const c of (data ?? []) as { phone: string; name: string | null; name_override: string | null; wa_b_customer_id: string | null }[]) {
      const p = tenDigit(c.phone)
      const rec = byPhone.get(p); if (rec) rec.name = (c.name_override || c.name) ?? null
      if (c.wa_b_customer_id) bIdToPhone.set(c.wa_b_customer_id, p)
    }
  }

  // ── replied: inbound messages from these phones after the send ──────────────
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
    for (const m of (data ?? []) as { thread_id: string }[]) {
      const p = threadToPhone.get(m.thread_id); const rec = p ? byPhone.get(p) : undefined
      if (rec) rec.replied = true
    }
  }

  // ── converted: last purchase within 90 days AFTER the send ──────────────────
  const untilISO = addDays(sinceISO, CONV_DAYS)
  const sinceDate = sinceISO.slice(0, 10), untilDate = untilISO.slice(0, 10)
  const bIds = [...bIdToPhone.keys()]
  for (let i = 0; i < bIds.length; i += 300) {
    const { data } = await supabaseAdmin.from('wa_b_markers')
      .select('customer_id, last_purchase_date').in('customer_id', bIds.slice(i, i + 300))
      .gte('last_purchase_date', sinceDate).lte('last_purchase_date', untilDate)
    for (const m of (data ?? []) as { customer_id: string; last_purchase_date: string | null }[]) {
      const p = bIdToPhone.get(m.customer_id); const rec = p ? byPhone.get(p) : undefined
      if (rec) rec.converted = true
    }
  }

  // ── assemble funnel + per-recipient list ────────────────────────────────────
  const recips = [...byPhone.values()]
  const sentRecs = recips.filter(r => r.status === 'sent')
  const funnel = {
    sent: sentRecs.length,
    delivered: sentRecs.filter(r => r.delivered).length,
    read: sentRecs.filter(r => r.read).length,
    replied: sentRecs.filter(r => r.replied).length,
    converted: sentRecs.filter(r => r.converted).length,
    failed: recips.filter(r => r.status === 'failed').length,
  }

  // Order: failed first (need attention), then by furthest stage reached (best last).
  const RANK: Record<string, number> = { failed: 0, sent: 1, delivered: 2, read: 3, replied: 4, converted: 5 }
  const recipients = recips
    .map(r => ({ phone: r.phone, name: r.name, stage: stage(r), error: r.error }))
    .sort((a, b) => (a.stage === 'failed' ? -1 : b.stage === 'failed' ? 1 : RANK[b.stage] - RANK[a.stage]))

  return Response.json({
    id, source, label, template, sentAt: sinceISO, convWindowDays: CONV_DAYS,
    funnel, recipients,
  })
}
