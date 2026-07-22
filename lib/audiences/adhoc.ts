import { supabaseAdmin } from '@/lib/supabase/admin'
import { tenDigit } from '@/lib/reach/resolve'
import { runStep, type RunStepResult } from '@/lib/audiences/steps'

// ═══════════════════════════════════════════════════════════════════════════
//  AD-HOC → AUDIENCE (server-only). Reach and Call Control both resolve a cohort
//  and act on it once. Instead of leaving that as an anonymous run, we spin the
//  cohort into a real AUDIENCE and record the action as its first STEP — so every
//  send/call becomes a continuable funnel (add step 2: carry read/replied →
//  narrow → send again). This is what folds the old parallel surfaces into the
//  one spine without removing their fast entry points.
// ═══════════════════════════════════════════════════════════════════════════

/** Create a fixed audience materialised from an already-resolved cohort. */
export async function createAudienceFromCohort(opts: {
  name: string
  phones: string[]
  filter?: unknown
  userId: string
  isDynamic?: boolean
}): Promise<{ audienceId: string } | { error: string }> {
  const phones = [...new Set(opts.phones.map(tenDigit).filter(p => p.length === 10))]
  const { data: aud, error } = await supabaseAdmin.from('wa_audiences').insert({
    name: opts.name.trim() || 'Untitled audience',
    filter: opts.filter ?? {}, is_dynamic: !!opts.isDynamic, is_active: true, is_seeded: false,
    member_count: phones.length, last_refreshed_at: new Date().toISOString(), created_by: opts.userId,
  }).select('id').single()
  if (error || !aud) return { error: error?.message ?? 'Could not create audience.' }
  const audienceId = aud.id as string

  for (let i = 0; i < phones.length; i += 500) {
    const rows = phones.slice(i, i + 500).map(p => ({ audience_id: audienceId, phone: p }))
    await supabaseAdmin.from('audience_members').upsert(rows, { onConflict: 'audience_id,phone', ignoreDuplicates: true })
  }
  return { audienceId }
}

/**
 * Adopt an ALREADY-SENT Reach campaign as step 1 of an audience — no re-send.
 * The chat funnel derives from the campaign ledger, so "send N more" later on the
 * same campaign flows through automatically.
 */
export async function adoptChatCampaignAsStep(opts: {
  audienceId: string
  campaignId: string
  enteredPhones: string[]
  templateId: string
  name: string
  userId: string
}): Promise<void> {
  const { data: last } = await supabaseAdmin.from('audience_steps')
    .select('seq').eq('audience_id', opts.audienceId).order('seq', { ascending: false }).limit(1).maybeSingle()
  const seq = ((last?.seq as number) ?? 0) + 1

  const { data: step } = await supabaseAdmin.from('audience_steps').insert({
    audience_id: opts.audienceId, seq, name: opts.name.trim() || null,
    carry_signal: 'all', action: 'chat', template_id: opts.templateId,
    status: 'run', campaign_id: opts.campaignId, entered_count: opts.enteredPhones.length,
    run_at: new Date().toISOString(), created_by: opts.userId,
  }).select('id').single()
  if (!step) return

  // Freeze who entered, and link the campaign back to the audience.
  const phones = [...new Set(opts.enteredPhones.map(tenDigit).filter(p => p.length === 10))]
  for (let i = 0; i < phones.length; i += 500) {
    const rows = phones.slice(i, i + 500).map(p => ({ step_id: step.id as string, phone: p }))
    await supabaseAdmin.from('audience_step_members').upsert(rows, { onConflict: 'step_id,phone', ignoreDuplicates: true })
  }
  await supabaseAdmin.from('wa_campaigns').update({ audience_id: opts.audienceId }).eq('id', opts.campaignId)
}

/** Create a draft call step on an audience and run it (mints the deck). */
export async function createAndRunCallStep(opts: {
  audienceId: string
  name: string
  userId: string
}): Promise<RunStepResult & { stepId?: string }> {
  const { data: step, error } = await supabaseAdmin.from('audience_steps').insert({
    audience_id: opts.audienceId, seq: 1, name: opts.name.trim() || null,
    carry_signal: 'all', action: 'call', status: 'draft', created_by: opts.userId,
  }).select('id').single()
  if (error || !step) return { error: error?.message ?? 'Could not create call step.', entered: 0 }
  const result = await runStep(step.id as string, opts.userId)
  return { ...result, stepId: step.id as string }
}
