import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'

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
    replied = 0  // reply attribution is shown on /campaigns detail; kept 0 here to stay light
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
    let attempts = 0, connected = 0
    for (let from = 0; ; from += 1000) {
      const { data } = await supabaseAdmin.from('wa_b_call_logs')
        .select('success, task:wa_b_call_tasks!inner(campaign_id)')
        .eq('task.campaign_id', c.id).range(from, from + 999)
      const rows = (data ?? []) as unknown as Array<{ success: boolean | null }>
      for (const r of rows) { attempts++; if (r.success === true) connected++ }
      if (rows.length < 1000) break
    }
    call.push({ campaignId: c.id, name: c.name, isActive: c.is_active, cards: cards ?? 0, attempts, connected, createdAt: c.created_at })
  }

  return Response.json({ chat, call })
}
