import { supabaseAdmin } from '@/lib/supabase/admin'
import { tenDigit } from '@/lib/reach/resolve'
import { resolveRuleTree } from '@/lib/audiences/resolve-rules'
import { isEmptyTree, type RuleTree } from '@/lib/audiences/rules'
import { dispatchTemplate } from '@/lib/reach/dispatch'
import { callableTypeB, mintCallDeck, notCallableMessage } from '@/lib/calls/deck'

// ═══════════════════════════════════════════════════════════════════════════
//  STEPS ENGINE (server-only) — the multi-step funnel on an audience.
//
//  A step CARRIES a cohort from the previous step's outcome, optionally NARROWS
//  it by markers (the same rule engine as everywhere), then ACTS (chat / call).
//  Every carry signal is an EXACT join — no time-window guessing:
//    · delivered / read — wa_message_events (keyed to the step campaign's wamids)
//    · replied          — a quick-reply button tap, recorded as a wa_message_events
//                         'replied' row against the step send's wamid (see webhook)
//    · connected        — wa_b_call_logs.success = true for the step's call deck
//
//  Chat outcomes derive from the step's CAMPAIGN ledger (campaign_id), not the
//  frozen member snapshot — so a Reach blast adopted as a step, and any "send N
//  more" done later on that campaign, are both reflected. audience_step_members
//  freezes who ENTERED (for the entered count and 'all'-carry).
// ═══════════════════════════════════════════════════════════════════════════

export type CarrySignal = 'all' | 'delivered' | 'read' | 'replied' | 'connected'
export type StepAction = 'chat' | 'call'

export interface StepRow {
  id: string
  audience_id: string
  seq: number
  name: string | null
  carry_signal: CarrySignal
  carry_button: string | null
  narrow_rules: RuleTree | null
  action: StepAction
  template_id: string | null
  status: 'draft' | 'run'
  campaign_id: string | null
  call_campaign_id: string | null
  entered_count: number | null
  run_at: string | null
}

const CHAT_SIGNALS: CarrySignal[] = ['delivered', 'read', 'replied']

// ── Snapshot + ledger helpers ────────────────────────────────────────────────

async function memberPhones(stepId: string): Promise<string[]> {
  const out: string[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await supabaseAdmin.from('audience_step_members')
      .select('phone').eq('step_id', stepId).range(from, from + 999)
    const rows = (data ?? []) as Array<{ phone: string }>
    out.push(...rows.map(r => tenDigit(r.phone)))
    if (rows.length < 1000) break
  }
  return out
}

/** Every successful send under this step's campaign: wamid -> phone. */
async function campaignSends(campaignId: string | null): Promise<Map<string, string>> {
  const byWamid = new Map<string, string>()
  if (!campaignId) return byWamid
  for (let from = 0; ; from += 1000) {
    const { data } = await supabaseAdmin.from('wa_send_ledger')
      .select('phone, wa_message_id').eq('campaign_id', campaignId).eq('status', 'sent')
      .not('wa_message_id', 'is', null).range(from, from + 999)
    const rows = (data ?? []) as Array<{ phone: string; wa_message_id: string }>
    for (const r of rows) byWamid.set(r.wa_message_id, tenDigit(r.phone))
    if (rows.length < 1000) break
  }
  return byWamid
}

/** wamids that have an event in `statuses` (+ optional button on a 'replied'). */
async function wamidsWithStatus(
  wamids: string[], statuses: string[], button: string | null,
): Promise<Set<string>> {
  const hit = new Set<string>()
  for (let i = 0; i < wamids.length; i += 300) {
    const { data } = await supabaseAdmin.from('wa_message_events')
      .select('wa_message_id, status, raw').in('wa_message_id', wamids.slice(i, i + 300)).in('status', statuses)
    for (const e of (data ?? []) as Array<{ wa_message_id: string; status: string; raw: { button?: string } | null }>) {
      if (button && e.status === 'replied' && (e.raw?.button ?? null) !== button) continue
      hit.add(e.wa_message_id)
    }
  }
  return hit
}

// ── Engagement cohorts (who advanced from a step, by signal) ─────────────────

/** Phones that reached `signal` on this (already-run) step. */
export async function engagementCohort(
  step: StepRow, signal: CarrySignal, button: string | null = null,
): Promise<Set<string>> {
  if (signal === 'all') return new Set(await memberPhones(step.id))

  if (signal === 'connected') {
    const out = new Set<string>()
    if (!step.call_campaign_id) return out
    for (let from = 0; ; from += 1000) {
      const { data } = await supabaseAdmin.from('wa_b_call_logs')
        .select('success, customer:wa_b_customers!inner(phone), task:wa_b_call_tasks!inner(campaign_id)')
        .eq('task.campaign_id', step.call_campaign_id).range(from, from + 999)
      const rows = (data ?? []) as unknown as Array<{ success: boolean | null; customer: { phone: string } | { phone: string }[] | null }>
      for (const r of rows) {
        if (r.success !== true) continue
        const c = Array.isArray(r.customer) ? r.customer[0] : r.customer
        if (c?.phone) out.add(tenDigit(c.phone))
      }
      if (rows.length < 1000) break
    }
    return out
  }

  // Chat outcomes: delivered / read / replied, from the step campaign's ledger.
  const byWamid = await campaignSends(step.campaign_id)
  const statuses = signal === 'delivered' ? ['delivered', 'read'] : signal === 'read' ? ['read'] : ['replied']
  const hit = await wamidsWithStatus([...byWamid.keys()], statuses, signal === 'replied' ? button : null)
  const out = new Set<string>()
  for (const w of hit) { const p = byWamid.get(w); if (p) out.add(p) }
  return out
}

// ── Input resolution: carry from previous step, then narrow ──────────────────

/** The phones a step will act on: previous step's carry cohort ∩ narrow. */
export async function resolveStepInput(step: StepRow): Promise<{ phones: string[]; error?: string }> {
  let base: Set<string>

  if (step.seq <= 1) {
    base = new Set<string>()
    for (let from = 0; ; from += 1000) {
      const { data } = await supabaseAdmin.from('audience_members')
        .select('phone').eq('audience_id', step.audience_id).range(from, from + 999)
      const rows = (data ?? []) as { phone: string }[]
      for (const r of rows) base.add(tenDigit(r.phone))
      if (rows.length < 1000) break
    }
  } else {
    const prev = await previousStep(step)
    if (!prev) return { phones: [], error: 'No previous step to carry from.' }
    if (prev.status !== 'run') return { phones: [], error: `Run step ${prev.seq} first.` }
    if (step.carry_signal !== 'all') {
      if (CHAT_SIGNALS.includes(step.carry_signal) && prev.action !== 'chat') {
        return { phones: [], error: `Step ${prev.seq} was a call — carry by "connected", not "${step.carry_signal}".` }
      }
      if (step.carry_signal === 'connected' && prev.action !== 'call') {
        return { phones: [], error: `Step ${prev.seq} was a chat — carry by delivered / read / replied.` }
      }
    }
    base = await engagementCohort(prev, step.carry_signal, step.carry_button)
  }

  if (step.narrow_rules && !isEmptyTree(step.narrow_rules)) {
    const { phones: narrowSet, error } = await resolveRuleTree(step.narrow_rules)
    if (error) return { phones: [], error }
    base = new Set([...base].filter(p => narrowSet.has(p)))
  }

  return { phones: [...base] }
}

async function previousStep(step: StepRow): Promise<StepRow | null> {
  const { data } = await supabaseAdmin.from('audience_steps')
    .select('*').eq('audience_id', step.audience_id).eq('seq', step.seq - 1).maybeSingle()
  return (data as StepRow) ?? null
}

// ── Run a step ───────────────────────────────────────────────────────────────

export interface RunStepResult {
  error?: string
  entered: number
  sent?: number; failed?: number; skippedSuppressed?: number; skippedDnc?: number
  callable?: number; unreachable?: number; snoozed?: number
}

export async function runStep(stepId: string, userId: string): Promise<RunStepResult> {
  const { data: stepData } = await supabaseAdmin.from('audience_steps').select('*').eq('id', stepId).maybeSingle()
  const step = stepData as StepRow | null
  if (!step) return { error: 'Step not found', entered: 0 }
  if (step.status === 'run') return { error: 'This step has already been run.', entered: 0 }

  const { phones: entered, error: inErr } = await resolveStepInput(step)
  if (inErr) return { error: inErr, entered: 0 }
  if (entered.length === 0) return { error: 'No one matches this step (after carry + narrow).', entered: 0 }

  const { data: aud } = await supabaseAdmin.from('wa_audiences').select('name, filter').eq('id', step.audience_id).maybeSingle()
  const label = step.name?.trim() || `${aud?.name ?? 'Audience'} · step ${step.seq}`

  await snapshotEntered(step.id, entered)

  if (step.action === 'chat') {
    if (!step.template_id) return { error: 'This chat step has no template.', entered: entered.length }
    const { data: template } = await supabaseAdmin.from('wa_message_templates')
      .select('id, name, meta_template_name, category').eq('id', step.template_id).maybeSingle()
    if (!template) return { error: 'Template not found.', entered: entered.length }
    if (!template.meta_template_name) return { error: 'That template has no Meta-approved template linked.', entered: entered.length }

    // Each step is its OWN campaign so its funnel is isolated.
    const { data: camp, error: cErr } = await supabaseAdmin.from('wa_campaigns').insert({
      name: label, cohort_label: label, audience_id: step.audience_id,
      template_id: template.id, template_name: template.name,
      meta_template_name: template.meta_template_name, category: template.category ?? 'custom',
      filter: aud?.filter ?? null, is_dynamic: false, status: 'active', total: entered.length,
      last_refreshed_at: new Date().toISOString(), sent_by: userId,
    }).select('id').single()
    if (cErr || !camp) return { error: cErr?.message ?? 'Could not create the step campaign.', entered: entered.length }
    const campaignId = camp.id as string

    const result = await dispatchTemplate({
      templateId: template.id, recipients: entered.map(p => ({ phone: p })),
      userId, campaignId, cohortLabel: label, limit: null,
    })
    if (result.error) return { error: result.error, entered: entered.length }

    await supabaseAdmin.from('audience_steps').update({
      status: 'run', campaign_id: campaignId, entered_count: entered.length, run_at: new Date().toISOString(),
    }).eq('id', step.id)

    return {
      entered: entered.length, sent: result.sent, failed: result.failed,
      skippedSuppressed: result.skippedSuppressed, skippedDnc: result.skippedDnc,
    }
  }

  // ── call ──
  const { ids, unreachable, snoozed } = await callableTypeB(new Set(entered.map(tenDigit)))
  if (ids.length === 0) return { error: notCallableMessage(snoozed, unreachable), entered: entered.length }
  const res = await mintCallDeck({
    name: label, customerIds: ids, createdBy: userId, audienceId: step.audience_id, filterJson: step.narrow_rules ?? null,
  })
  if ('error' in res) return { error: res.error, entered: entered.length }

  await supabaseAdmin.from('audience_steps').update({
    status: 'run', call_campaign_id: res.campaignId, entered_count: entered.length, run_at: new Date().toISOString(),
  }).eq('id', step.id)

  return { entered: entered.length, callable: ids.length, unreachable, snoozed }
}

async function snapshotEntered(stepId: string, phones: string[]): Promise<void> {
  for (let i = 0; i < phones.length; i += 500) {
    const rows = phones.slice(i, i + 500).map(p => ({ step_id: stepId, phone: tenDigit(p) }))
    await supabaseAdmin.from('audience_step_members').upsert(rows, { onConflict: 'step_id,phone', ignoreDuplicates: true })
  }
}

// ── Per-step funnel counts (for the report) ──────────────────────────────────

export interface StepFunnel {
  entered: number
  sent?: number; delivered?: number; read?: number; replied?: number
  attempts?: number; connected?: number; notConnected?: number; pending?: number
}

export async function stepFunnel(step: StepRow): Promise<StepFunnel> {
  if (step.status !== 'run') return { entered: 0 }
  const entered = step.entered_count ?? (await memberPhones(step.id)).length

  if (step.action === 'chat') {
    const wamids = [...(await campaignSends(step.campaign_id)).keys()]
    const delivered = await wamidsWithStatus(wamids, ['delivered', 'read'], null)
    const read = await wamidsWithStatus(wamids, ['read'], null)
    const replied = await wamidsWithStatus(wamids, ['replied'], null)
    return { entered, sent: wamids.length, delivered: delivered.size, read: read.size, replied: replied.size }
  }

  let attempts = 0, connected = 0, notConnected = 0, pending = 0
  if (step.call_campaign_id) {
    for (let from = 0; ; from += 1000) {
      const { data } = await supabaseAdmin.from('wa_b_call_logs')
        .select('success, task:wa_b_call_tasks!inner(campaign_id)')
        .eq('task.campaign_id', step.call_campaign_id).range(from, from + 999)
      const rows = (data ?? []) as unknown as Array<{ success: boolean | null }>
      for (const r of rows) { attempts++; if (r.success === true) connected++; else if (r.success === false) notConnected++; else pending++ }
      if (rows.length < 1000) break
    }
  }
  return { entered, attempts, connected, notConnected, pending }
}
