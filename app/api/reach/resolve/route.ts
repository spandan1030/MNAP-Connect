import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { resolveCohortPhones, tenDigit } from '@/lib/reach/resolve'
import type { ReachFilter, ReachRecipient } from '@/lib/types'

// Reach — resolve a cohort into a phone list, each decorated with markers,
// opt-out flags, prior sends, and (with a template) whether it's suppressed.
//   POST { filter, templateId? } -> { total, capped, recipients }
// Cohort membership itself lives in lib/reach/resolve (shared with campaigns).

const DECORATE_CAP = 1000  // fully-decorate at most this many; narrow if more

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { filter, templateId } = (await req.json()) as { filter?: ReachFilter; templateId?: string }
  const f: ReachFilter = filter ?? {}

  // ── 1. Resolve candidate phones (shared logic) ────────────────────────────
  const { phones: candidate, error } = await resolveCohortPhones(f)
  if (error) return Response.json({ error }, { status: 400 })

  const total = candidate.size
  const phones = [...candidate].slice(0, DECORATE_CAP)

  // ── 2. Decorate the (capped) phone list ──────────────────────────────────
  const custByPhone = new Map<string, { id: string; name: string | null; is_hot_lead: boolean; is_do_not_call: boolean }>()
  const markerByPhone = new Map<string, Record<string, unknown>>()
  for (let i = 0; i < phones.length; i += 300) {
    const chunk = phones.slice(i, i + 300)
    const { data } = await supabaseAdmin.from('wa_b_customers')
      .select('id, phone, name, is_hot_lead, is_do_not_call, wa_b_markers(recency_tier,value_tier,rfm_segment,primary_metal,lifetime_value)')
      .in('phone', chunk)
    for (const c of (data ?? []) as unknown as Array<{ id: string; phone: string; name: string | null; is_hot_lead: boolean; is_do_not_call: boolean; wa_b_markers: Record<string, unknown> | null }>) {
      const p = tenDigit(c.phone)
      custByPhone.set(p, { id: c.id, name: c.name, is_hot_lead: c.is_hot_lead, is_do_not_call: c.is_do_not_call })
      const mk = Array.isArray(c.wa_b_markers) ? c.wa_b_markers[0] : c.wa_b_markers
      if (mk) markerByPhone.set(p, mk as Record<string, unknown>)
    }
  }

  // Unified consent + display name from the contact spine (covers chat-only
  // leads). chat_opted_out = STOP, call_opted_out = DNC, is_opted_out folds in manual.
  const contactByPhone = new Map<string, { name: string | null; chat: boolean; call: boolean; optedOut: boolean }>()
  for (let i = 0; i < phones.length; i += 300) {
    const { data } = await supabaseAdmin.from('contacts')
      .select('phone, name, name_override, chat_opted_out, call_opted_out, is_opted_out').in('phone', phones.slice(i, i + 300))
    for (const r of (data ?? []) as Array<{ phone: string; name: string | null; name_override: string | null; chat_opted_out: boolean; call_opted_out: boolean; is_opted_out: boolean }>) {
      contactByPhone.set(tenDigit(r.phone), { name: r.name_override || r.name, chat: r.chat_opted_out, call: r.call_opted_out, optedOut: r.is_opted_out })
    }
  }

  // Prior sends (last 90d) for history + suppression.
  const since = new Date(); since.setDate(since.getDate() - 90)
  const ledgerByPhone = new Map<string, Array<{ label: string; category: string | null; sentAt: string; key: string }>>()
  for (let i = 0; i < phones.length; i += 300) {
    const { data } = await supabaseAdmin.from('wa_send_ledger')
      .select('phone, meta_template_name, category, suppression_key, sent_at, template:wa_message_templates(name)')
      .in('phone', phones.slice(i, i + 300)).eq('status', 'sent').gte('sent_at', since.toISOString())
      .order('sent_at', { ascending: false })
    for (const r of (data ?? []) as unknown as Array<{ phone: string; meta_template_name: string | null; category: string | null; suppression_key: string; sent_at: string; template: { name: string } | null }>) {
      const p = tenDigit(r.phone)
      const tname = Array.isArray(r.template) ? r.template[0]?.name : r.template?.name
      const arr = ledgerByPhone.get(p) ?? []
      arr.push({ label: tname ?? r.meta_template_name ?? r.category ?? 'message', category: r.category, sentAt: r.sent_at, key: r.suppression_key })
      ledgerByPhone.set(p, arr)
    }
  }

  // Suppression for the chosen template.
  let suppKey: string | null = null
  let suppDays = 0
  if (templateId) {
    const { data: tpl } = await supabaseAdmin.from('wa_message_templates')
      .select('id, suppression_bucket, suppression_days').eq('id', templateId).maybeSingle()
    if (tpl) { suppKey = tpl.suppression_bucket || tpl.id; suppDays = tpl.suppression_days ?? 0 }
  }

  const recipients: ReachRecipient[] = phones.map(p => {
    const c = custByPhone.get(p)
    const m = markerByPhone.get(p) ?? {}
    const ct = contactByPhone.get(p)
    const sends = ledgerByPhone.get(p) ?? []
    let suppressedUntil: string | null = null
    if (suppKey && suppDays > 0) {
      const hit = sends.find(s => s.key === suppKey)
      if (hit) {
        const until = new Date(hit.sentAt); until.setDate(until.getDate() + suppDays)
        if (until > new Date()) suppressedUntil = until.toISOString()
      }
    }
    return {
      phone: p,
      name: ct?.name ?? c?.name ?? null,
      customerId: c?.id ?? null,
      recency_tier: (m.recency_tier as string) ?? null,
      value_tier: (m.value_tier as string) ?? null,
      rfm_segment: (m.rfm_segment as string) ?? null,
      primary_metal: (m.primary_metal as string) ?? null,
      lifetime_value: (m.lifetime_value as number) ?? null,
      is_hot_lead: c?.is_hot_lead ?? false,
      is_do_not_call: ct?.call ?? c?.is_do_not_call ?? false,
      dnd: (ct?.chat || (!!ct?.optedOut && !ct?.chat && !ct?.call)) ?? false,
      pastSends: sends.map(s => ({ label: s.label, category: s.category, sentAt: s.sentAt })),
      suppressedUntil,
    }
  })

  return Response.json({ total, capped: total > DECORATE_CAP, recipients })
}
