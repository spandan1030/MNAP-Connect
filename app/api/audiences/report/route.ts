import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { tenDigit } from '@/lib/reach/resolve'

// Unified per-audience insights: every activation of this audience, chat AND call.
//   GET /api/audiences/report?id=<uuid>
// Chat = the campaigns spawned from this audience (stored send counts + funnel from
// events). Call = the calling cohorts, with attempts/connected from the call logs.

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
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 })

  // ── Chat activations ──
  const { data: chatCamps } = await supabaseAdmin.from('wa_campaigns')
    .select('id, name, template_name, total, sent, failed, skipped_suppressed, created_at')
    .eq('audience_id', id).order('created_at', { ascending: false })

  // Delivery/read/reply per campaign, from message events + inbound replies.
  const chat = []
  for (const c of (chatCamps ?? []) as Array<Record<string, unknown>>) {
    const cid = c.id as string
    // wamids sent under this campaign (ledger) → look up their events.
    const wamids: string[] = []
    for (let from = 0; ; from += 1000) {
      const { data } = await supabaseAdmin.from('wa_send_ledger')
        .select('wa_message_id').eq('campaign_id', cid).not('wa_message_id', 'is', null).range(from, from + 999)
      const rows = (data ?? []) as { wa_message_id: string | null }[]
      wamids.push(...rows.map(r => r.wa_message_id!).filter(Boolean))
      if (rows.length < 1000) break
    }
    let delivered = 0, read = 0, replied = 0
    for (let i = 0; i < wamids.length; i += 300) {
      const { data: evs } = await supabaseAdmin.from('wa_message_events')
        .select('wa_message_id, status').in('wa_message_id', wamids.slice(i, i + 300))
      const byMsg = new Map<string, Set<string>>()
      for (const e of (evs ?? []) as { wa_message_id: string; status: string }[]) {
        let s = byMsg.get(e.wa_message_id); if (!s) { s = new Set(); byMsg.set(e.wa_message_id, s) }
        s.add(e.status)
      }
      for (const s of byMsg.values()) { if (s.has('delivered') || s.has('read')) delivered++; if (s.has('read')) read++ }
    }
    // Replies: an inbound message from a recipient AFTER this campaign started.
    // This used to be hardcoded to 0 "to stay light", which meant the report
    // showed a real-looking zero for every audience — worse than showing
    // nothing. Same definition as /campaigns detail, so the two agree.
    {
      const phones: string[] = []
      for (let from = 0; ; from += 1000) {
        const { data } = await supabaseAdmin.from('wa_send_ledger')
          .select('phone').eq('campaign_id', cid).range(from, from + 999)
        const rows = (data ?? []) as { phone: string }[]
        phones.push(...rows.map(r => tenDigit(r.phone)))
        if (rows.length < 1000) break
      }
      const uniq = [...new Set(phones)]
      const threadToPhone = new Map<string, string>()
      for (let i = 0; i < uniq.length; i += 300) {
        const { data } = await supabaseAdmin.from('wa_threads')
          .select('id, phone').in('phone', uniq.slice(i, i + 300))
        for (const t of (data ?? []) as { id: string; phone: string }[]) {
          threadToPhone.set(t.id, tenDigit(t.phone))
        }
      }
      const since = c.created_at as string
      const repliedPhones = new Set<string>()
      const tids = [...threadToPhone.keys()]
      for (let i = 0; i < tids.length; i += 200) {
        const { data } = await supabaseAdmin.from('wa_messages')
          .select('thread_id').eq('direction', 'inbound').gte('created_at', since)
          .in('thread_id', tids.slice(i, i + 200))
        for (const m of (data ?? []) as { thread_id: string }[]) {
          const p = threadToPhone.get(m.thread_id)
          if (p) repliedPhones.add(p)
        }
      }
      replied = repliedPhones.size
    }
    chat.push({
      campaignId: cid, name: c.name, template: c.template_name,
      total: c.total ?? 0, sent: c.sent ?? 0, failed: c.failed ?? 0,
      skipped: c.skipped_suppressed ?? 0, delivered, read, replied, createdAt: c.created_at,
    })
  }

  // ── Call activations ──
  const { data: callCamps } = await supabaseAdmin.from('wa_b_call_campaigns')
    .select('id, name, is_active, created_at').eq('audience_id', id).order('created_at', { ascending: false })

  const call = []
  for (const c of (callCamps ?? []) as Array<{ id: string; name: string; is_active: boolean; created_at: string }>) {
    const { count: cards } = await supabaseAdmin.from('wa_b_call_tasks')
      .select('id', { count: 'exact', head: true }).eq('campaign_id', c.id)
    // Attempts / connected from logs whose task belongs to this campaign.
    // A call log is one of THREE things, not two. Reporting only attempts and
    // connected left an unexplained gap: pending cards (Call tapped, outcome
    // never saved) counted as attempts but as neither outcome, so the numbers
    // never added up. All three are returned now, and they reconcile:
    //   attempts = connected + notConnected + pending
    let attempts = 0, connected = 0, notConnected = 0, pending = 0
    for (let from = 0; ; from += 1000) {
      const { data } = await supabaseAdmin.from('wa_b_call_logs')
        .select('success, task:wa_b_call_tasks!inner(campaign_id)')
        .eq('task.campaign_id', c.id).range(from, from + 999)
      const rows = (data ?? []) as unknown as Array<{ success: boolean | null }>
      for (const r of rows) {
        attempts++
        if (r.success === true) connected++
        else if (r.success === false) notConnected++
        else pending++
      }
      if (rows.length < 1000) break
    }
    call.push({
      campaignId: c.id, name: c.name, isActive: c.is_active, cards: cards ?? 0,
      attempts, connected, notConnected, pending, createdAt: c.created_at,
    })
  }

  // ── What actually happened on those calls ──
  // Mirrors /admin/calls/report (topics, intent, salesman, hot leads) but scoped
  // to this audience's cohorts instead of a date range. Counts are over ALL calls
  // ever made under them, so the picture matches the campaign's whole life.
  const campIds = ((callCamps ?? []) as Array<{ id: string }>).map(c => c.id)
  let callSummary: Record<string, unknown> | null = null
  if (campIds.length > 0) {
    interface LogRow {
      success: boolean | null
      topics: string[] | null
      intent: string | null
      salesman_id: string | null
      salesman: { alias: string } | { alias: string }[] | null
      customer: { name: string; phone: string; is_hot_lead: boolean } | { name: string; phone: string; is_hot_lead: boolean }[] | null
    }
    const logs: LogRow[] = []
    for (let from = 0; ; from += 1000) {
      const { data } = await supabaseAdmin.from('wa_b_call_logs')
        .select('success, topics, intent, salesman_id, salesman:salesmen(alias), customer:wa_b_customers!inner(name,phone,is_hot_lead), task:wa_b_call_tasks!inner(campaign_id)')
        .in('task.campaign_id', campIds).range(from, from + 999)
      const rows = (data ?? []) as unknown as LogRow[]
      logs.push(...rows)
      if (rows.length < 1000) break
    }
    const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)

    const topics: Record<string, number> = {}
    const intents: Record<string, number> = {}
    const bySalesman = new Map<string, { alias: string; attempts: number; connected: number }>()
    const hot = new Map<string, { name: string; phone: string }>()
    let attempts = 0, connected = 0, noAnswer = 0, pending = 0

    for (const l of logs) {
      attempts++
      if (l.success === true) connected++
      else if (l.success === false) noAnswer++
      else pending++

      // Topics are only meaningful on a connected call (that's when they're asked).
      if (l.success === true) for (const t of l.topics ?? []) topics[t] = (topics[t] ?? 0) + 1
      if (l.intent) intents[l.intent] = (intents[l.intent] ?? 0) + 1

      const sid = l.salesman_id ?? '—'
      let s = bySalesman.get(sid)
      if (!s) { s = { alias: one(l.salesman)?.alias ?? '—', attempts: 0, connected: 0 }; bySalesman.set(sid, s) }
      s.attempts++; if (l.success === true) s.connected++

      const cust = one(l.customer)
      if (cust?.is_hot_lead) hot.set(cust.phone, { name: cust.name, phone: cust.phone })
    }

    callSummary = {
      attempts, connected, noAnswer, pending,
      topics, intents,
      hotLeads: [...hot.values()],
      bySalesman: [...bySalesman.values()].sort((a, b) => b.attempts - a.attempts),
    }
  }

  return Response.json({ chat, call, callSummary })
}
