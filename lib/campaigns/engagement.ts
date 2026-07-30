import { supabaseAdmin } from '@/lib/supabase/admin'
import { tenDigit } from '@/lib/reach/resolve'

// ═══════════════════════════════════════════════════════════════════════════
//  CAMPAIGN ENGAGEMENT (server-only) — per-recipient outcome for one chat
//  campaign, and the phone list at a given engagement STAGE.
//
//  This is the "chat-engagement carry" primitive: after sending template T1 to
//  an audience, `phonesAtStage(campaignId, 'read')` returns exactly the people
//  who read it — which we then materialise into a new audience to send T2 to.
//  Same joins the campaign drill-down uses (ledger ⋈ message events ⋈ inbound),
//  trimmed to what carry needs.
//
//  NOTE: intentionally mirrors part of /api/campaigns/detail. A later pass will
//  share one recipient builder between the two (see INSIGHTS_UNIFICATION_PLAN).
// ═══════════════════════════════════════════════════════════════════════════

export type EngagementStage =
  | 'read'                // opened it
  | 'replied'             // sent us a message back after the send
  | 'delivered'           // reached their phone (includes read)
  | 'delivered_not_read'  // reached them but not opened — a nudge cohort
  | 'not_delivered'       // sent, no delivery receipt — a retry cohort

export const STAGE_LABEL: Record<EngagementStage, string> = {
  read: 'who read',
  replied: 'who replied',
  delivered: 'delivered to',
  delivered_not_read: 'delivered, not read',
  not_delivered: 'not delivered',
}

interface Recip {
  delivered: boolean
  read: boolean
  replied: boolean
  failed: boolean
}

/** phone -> outcome, for everyone SENT under this campaign. */
export async function campaignEngagement(campaignId: string): Promise<Map<string, Recip>> {
  const byPhone = new Map<string, Recip>()
  const wamidToPhone = new Map<string, string>()

  // When the campaign started — replies only count after this.
  const { data: camp } = await supabaseAdmin.from('wa_campaigns')
    .select('created_at').eq('id', campaignId).maybeSingle()
  const sinceISO = (camp?.created_at as string | undefined) ?? new Date(0).toISOString()

  // The send set (ledger). status 'sent' = went out; anything else = failed.
  for (let from = 0; ; from += 1000) {
    const { data } = await supabaseAdmin.from('wa_send_ledger')
      .select('phone, wa_message_id, status').eq('campaign_id', campaignId).range(from, from + 999)
    const rows = (data ?? []) as { phone: string; wa_message_id: string | null; status: string }[]
    for (const r of rows) {
      const p = tenDigit(r.phone)
      const rec = byPhone.get(p) ?? { delivered: false, read: false, replied: false, failed: false }
      if (r.status !== 'sent') rec.failed = true
      byPhone.set(p, rec)
      if (r.wa_message_id) wamidToPhone.set(r.wa_message_id, p)
    }
    if (rows.length < 1000) break
  }

  // Delivery / read from the event timeline.
  const wamids = [...wamidToPhone.keys()]
  for (let i = 0; i < wamids.length; i += 300) {
    const { data } = await supabaseAdmin.from('wa_message_events')
      .select('wa_message_id, status').in('wa_message_id', wamids.slice(i, i + 300))
      .in('status', ['delivered', 'read'])
    for (const e of (data ?? []) as { wa_message_id: string; status: string }[]) {
      const p = wamidToPhone.get(e.wa_message_id); if (!p) continue
      const rec = byPhone.get(p); if (!rec) continue
      rec.delivered = true
      if (e.status === 'read') rec.read = true
    }
  }

  // Replies: any inbound from a recipient after the send went out.
  const phoneList = [...byPhone.keys()]
  const threadToPhone = new Map<string, string>()
  for (let i = 0; i < phoneList.length; i += 300) {
    const { data } = await supabaseAdmin.from('wa_threads')
      .select('id, phone').in('phone', phoneList.slice(i, i + 300))
    for (const t of (data ?? []) as { id: string; phone: string }[]) threadToPhone.set(t.id, tenDigit(t.phone))
  }
  const tids = [...threadToPhone.keys()]
  for (let i = 0; i < tids.length; i += 200) {
    const { data } = await supabaseAdmin.from('wa_messages')
      .select('thread_id').eq('direction', 'inbound').gte('created_at', sinceISO)
      .in('thread_id', tids.slice(i, i + 200))
    for (const m of (data ?? []) as { thread_id: string }[]) {
      const p = threadToPhone.get(m.thread_id); const rec = p ? byPhone.get(p) : undefined
      if (rec) rec.replied = true
    }
  }

  return byPhone
}

function matches(r: Recip, stage: EngagementStage): boolean {
  switch (stage) {
    case 'read': return r.read
    case 'replied': return r.replied
    case 'delivered': return r.delivered
    case 'delivered_not_read': return r.delivered && !r.read
    case 'not_delivered': return !r.failed && !r.delivered
  }
}

/** Phones from a campaign that reached a given engagement stage (successful sends only). */
export async function phonesAtStage(campaignId: string, stage: EngagementStage): Promise<string[]> {
  const eng = await campaignEngagement(campaignId)
  const out: string[] = []
  for (const [phone, r] of eng) {
    if (r.failed) continue          // failed sends never carry
    if (matches(r, stage)) out.push(phone)
  }
  return out
}
