import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'

// Campaign detail: the funnel summary PLUS a per-recipient breakdown — for every
// number in the campaign, what happened to its message (sent → delivered → read
// → replied → converted), with the sent/delivered/read timestamps and, for
// anything that didn't deliver, the Meta error code + reason. Matches (and
// extends, with replied/converted) the old broadcast report.
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
  wamid: string | null; error: string | null; errorCode: number | null
  sentAt: string | null; deliveredAt: string | null; readAt: string | null
  delivered: boolean; read: boolean; replied: boolean; converted: boolean
}

// Furthest stage a recipient reached — drives the row's status label + ordering.
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
  // delivery receipts (keyed by message id) back to a person.
  const byPhone = new Map<string, Recip>()
  const wamidToPhone = new Map<string, string>()
  let sinceISO = new Date().toISOString()
  let label = 'Campaign', template: string | null = null

  const blank = (p: string): Recip => ({
    phone: p, name: null, status: 'sent', wamid: null, error: null, errorCode: null,
    sentAt: null, deliveredAt: null, readAt: null,
    delivered: false, read: false, replied: false, converted: false,
  })

  if (source === 'reach') {
    const { data: camp } = await supabaseAdmin.from('wa_campaigns')
      .select('cohort_label, template_name, created_at').eq('id', id).maybeSingle()
    if (!camp) return Response.json({ error: 'Campaign not found' }, { status: 404 })
    label = (camp.cohort_label as string) || 'Reach send'
    template = (camp.template_name as string) ?? null
    sinceISO = camp.created_at as string
    for (let from = 0; ; from += 1000) {
      const { data } = await supabaseAdmin.from('wa_send_ledger')
        .select('phone, wa_message_id, status, error, sent_at').eq('campaign_id', id).range(from, from + 999)
      const rows = (data ?? []) as { phone: string; wa_message_id: string | null; status: string; error: string | null; sent_at: string | null }[]
      for (const r of rows) {
        const p = tenDigit(r.phone)
        const prev = byPhone.get(p)
        if (!(prev && prev.status === 'sent')) {
          const rec = blank(p)
          rec.status = r.status === 'sent' ? 'sent' : 'failed'
          rec.wamid = r.wa_message_id ?? null
          rec.error = r.error ?? null
          rec.sentAt = r.sent_at ?? null
          byPhone.set(p, rec)
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
    const rowsByThread: Array<{ wa_message_id: string | null; thread_id: string | null; status: string; error_code: number | null; error_title: string | null; failed_reason: string | null; sent_at: string | null }> = []
    for (let from = 0; ; from += 1000) {
      const { data } = await supabaseAdmin.from('wa_messages')
        .select('wa_message_id, thread_id, status, error_code, error_title, failed_reason, sent_at')
        .eq('broadcast_id', id).eq('direction', 'outbound').range(from, from + 999)
      const rows = (data ?? []) as typeof rowsByThread
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
      const rec = blank(p)
      rec.status = r.status === 'failed' ? 'failed' : 'sent'
      rec.wamid = r.wa_message_id ?? null
      rec.error = r.error_title ?? r.failed_reason ?? null
      rec.errorCode = r.error_code ?? null
      rec.sentAt = r.sent_at ?? null
      byPhone.set(p, rec)
      if (r.wa_message_id) wamidToPhone.set(r.wa_message_id, p)
    }
  }

  const wamids = [...wamidToPhone.keys()]
  const phoneList = [...byPhone.keys()]

  // ── delivered / read / failed from the event timeline (with timestamps + Meta
  //    error codes). Latest event per status wins. ────────────────────────────
  for (let i = 0; i < wamids.length; i += 300) {
    const { data } = await supabaseAdmin.from('wa_message_events')
      .select('wa_message_id, status, event_at, error_code, error_title')
      .in('wa_message_id', wamids.slice(i, i + 300))
      .in('status', ['delivered', 'read', 'failed'])
    for (const e of (data ?? []) as { wa_message_id: string; status: string; event_at: string; error_code: number | null; error_title: string | null }[]) {
      const p = wamidToPhone.get(e.wa_message_id); if (!p) continue
      const rec = byPhone.get(p); if (!rec) continue
      if (e.status === 'delivered' || e.status === 'read') {
        rec.delivered = true
        if (!rec.deliveredAt || e.event_at > rec.deliveredAt) rec.deliveredAt = e.event_at
        if (e.status === 'read') { rec.read = true; if (!rec.readAt || e.event_at > rec.readAt) rec.readAt = e.event_at }
      } else if (e.status === 'failed') {
        rec.status = 'failed'
        if (e.error_code != null) rec.errorCode = e.error_code
        if (e.error_title) rec.error = e.error_title
      }
    }
  }

  // ── names from contacts (+ map to wa_b_customer for conversion) ─────────────
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

  // ── assemble funnel + failure breakdown + per-recipient list ────────────────
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

  // Failures grouped by Meta error code (or the raw reason when there's no code).
  const failBreak = new Map<string, number>()
  for (const r of recips.filter(r => r.status === 'failed')) {
    const key = r.errorCode != null ? String(r.errorCode) : (r.error ? `t:${r.error}` : 'unknown')
    failBreak.set(key, (failBreak.get(key) ?? 0) + 1)
  }
  const failureBreakdown = [...failBreak.entries()]
    .map(([key, count]) => ({
      code: key.startsWith('t:') ? null : (key === 'unknown' ? null : Number(key)),
      reason: key.startsWith('t:') ? key.slice(2) : null,
      count,
    }))
    .sort((a, b) => b.count - a.count)

  const RANK: Record<string, number> = { failed: 0, sent: 1, delivered: 2, read: 3, replied: 4, converted: 5 }
  const recipients = recips
    .map(r => ({
      phone: r.phone, name: r.name, stage: stage(r),
      error: r.error, errorCode: r.errorCode,
      sentAt: r.sentAt, deliveredAt: r.deliveredAt, readAt: r.readAt,
    }))
    .sort((a, b) => (a.stage === 'failed' ? -1 : b.stage === 'failed' ? 1 : RANK[b.stage] - RANK[a.stage]))

  return Response.json({
    id, source, label, template, sentAt: sinceISO, convWindowDays: CONV_DAYS,
    funnel, failureBreakdown, recipients,
  })
}
