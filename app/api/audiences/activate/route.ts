import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { resolveCohortPhones, tenDigit } from '@/lib/reach/resolve'
import { dispatchTemplate } from '@/lib/reach/dispatch'
import { isCallUnreachable, isCallSnoozed, MAX_FAILED_CALL_ATTEMPTS } from '@/lib/calls'
import type { ReachFilter } from '@/lib/types'

// Activate a saved audience on a channel — one audience, any channel, reusing the
// existing send + calling infra so reporting is shared.
//   POST { audienceId, channel: 'chat', templateId, subFilter?, limit? }
//        -> ensures ONE campaign per (audience, template), syncs members, dispatches
//           the next `limit` (suppression skips already-sent).
//   POST { audienceId, channel: 'call', subFilter? }
//        -> replaces the active calling cohort with this audience's members.
// subFilter (a ReachFilter) narrows the audience's members at send time WITHOUT
// changing the saved audience.

async function memberPhones(audienceId: string): Promise<string[]> {
  const out: string[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await supabaseAdmin.from('audience_members')
      .select('phone').eq('audience_id', audienceId).range(from, from + 999)
    const rows = (data ?? []) as { phone: string }[]
    out.push(...rows.map(r => r.phone))
    if (rows.length < 1000) break
  }
  return out
}

async function nameFor(phones: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  for (let i = 0; i < phones.length; i += 300) {
    const { data } = await supabaseAdmin.from('contacts')
      .select('phone, name, name_override').in('phone', phones.slice(i, i + 300))
    for (const r of (data ?? []) as Array<{ phone: string; name: string | null; name_override: string | null }>) {
      const nm = (r.name_override || r.name || '').trim()
      if (nm && nm !== 'Unknown') names.set(tenDigit(r.phone), nm)
    }
  }
  return names
}

// tenDigit-keyed phone -> wa_b_customers.id, for the member phones (needed to make
// call tasks). Scans Type B customers in pages (bounded ~10k) so it's robust to
// however phones are stored. Applies the calling gates (wa_044): do-not-call and
// the disconnect budget are both excluded here, so an unreachable customer never
// even gets a card minted.
async function typeBIds(want: Set<string>): Promise<{ ids: Map<string, string>; unreachable: number; snoozed: number }> {
  const ids = new Map<string, string>()
  let unreachable = 0
  let snoozed = 0
  for (let from = 0; ; from += 1000) {
    const { data } = await supabaseAdmin.from('wa_b_customers')
      .select('id, phone, is_do_not_call, failed_call_attempts, call_snooze_until').range(from, from + 999)
    const rows = (data ?? []) as Array<{ id: string; phone: string; is_do_not_call: boolean; failed_call_attempts: number | null; call_snooze_until: string | null }>
    for (const r of rows) {
      const p = tenDigit(r.phone)
      if (r.is_do_not_call || !want.has(p) || ids.has(p)) continue
      if (isCallUnreachable(r.failed_call_attempts)) { unreachable++; continue }
      // wa_048: still inside the post-call wait — not retired, just not yet.
      if (isCallSnoozed(r.call_snooze_until)) { snoozed++; continue }
      ids.set(p, r.id)
    }
    if (rows.length < 1000) break
  }
  return { ids, unreachable, snoozed }
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { audienceId, channel, templateId, subFilter, limit } = (await req.json().catch(() => ({}))) as {
    audienceId?: string; channel?: 'chat' | 'call'; templateId?: string; subFilter?: ReachFilter; limit?: number
  }
  if (!audienceId) return Response.json({ error: 'Missing audienceId' }, { status: 400 })

  const { data: aud } = await supabaseAdmin.from('wa_audiences')
    .select('id, name, filter').eq('id', audienceId).maybeSingle()
  if (!aud) return Response.json({ error: 'Audience not found' }, { status: 404 })

  // Members, optionally narrowed by a send-time sub-filter (AND).
  let phones = await memberPhones(audienceId)
  if (subFilter && Object.keys(subFilter).length > 0) {
    const { phones: subSet, error } = await resolveCohortPhones(subFilter)
    if (error) return Response.json({ error }, { status: 400 })
    phones = phones.filter(p => subSet.has(p))
  }
  if (phones.length === 0) return Response.json({ error: 'No members match (after any sub-filter).' }, { status: 400 })

  const names = await nameFor(phones)

  // ── CHAT ────────────────────────────────────────────────────────────────
  if (channel === 'chat') {
    if (!templateId) return Response.json({ error: 'Pick a template.' }, { status: 400 })
    const { data: template } = await supabaseAdmin.from('wa_message_templates')
      .select('id, name, meta_template_name, category').eq('id', templateId).single()
    if (!template) return Response.json({ error: 'Template not found' }, { status: 404 })
    if (!template.meta_template_name) return Response.json({ error: 'That template has no Meta-approved template linked.' }, { status: 400 })

    // One campaign per (audience, template) — reuse if it already exists so daily
    // sends accumulate into one funnel instead of spawning duplicates.
    const { data: existing } = await supabaseAdmin.from('wa_campaigns')
      .select('id').eq('audience_id', audienceId).eq('template_id', templateId).eq('status', 'active')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()

    let campaignId = existing?.id as string | undefined
    if (!campaignId) {
      const { data: camp, error: cErr } = await supabaseAdmin.from('wa_campaigns').insert({
        name: aud.name, cohort_label: aud.name, audience_id: audienceId,
        template_id: template.id, template_name: template.name,
        meta_template_name: template.meta_template_name, category: template.category ?? 'custom',
        filter: aud.filter, is_dynamic: false, status: 'active', total: phones.length,
        last_refreshed_at: new Date().toISOString(), sent_by: user.id,
      }).select('id').single()
      if (cErr || !camp) return Response.json({ error: cErr?.message ?? 'Could not create campaign.' }, { status: 500 })
      campaignId = camp.id as string
    }

    // Sync members (the send set) onto the campaign.
    for (let i = 0; i < phones.length; i += 500) {
      const rows = phones.slice(i, i + 500).map(p => ({ campaign_id: campaignId, phone: p, name: names.get(p) ?? null }))
      await supabaseAdmin.from('wa_campaign_members').upsert(rows, { onConflict: 'campaign_id,phone' })
    }

    const recipients = phones.map(p => ({ phone: p, name: names.get(p) ?? null }))
    const result = await dispatchTemplate({
      templateId, recipients, userId: user.id, campaignId: campaignId!, cohortLabel: aud.name,
      limit: (limit && limit > 0) ? limit : null,
    })
    if (result.error) return Response.json({ error: result.error }, { status: 500 })
    return Response.json({
      channel: 'chat', campaignId, sent: result.sent, failed: result.failed,
      skippedSuppressed: result.skippedSuppressed, skippedDnc: result.skippedDnc,
      eligibleRemaining: result.eligibleRemaining,
    })
  }

  // ── CALL ────────────────────────────────────────────────────────────────
  if (channel === 'call') {
    const { ids, unreachable, snoozed } = await typeBIds(new Set(phones.map(tenDigit)))
    const customerIds = [...ids.values()]
    if (customerIds.length === 0) {
      // "Snoozed" and "unreachable" are very different answers: one is wait,
      // the other is never. Say which, and how many of each.
      const why: string[] = []
      if (snoozed > 0) why.push(`${snoozed} were called recently and are still in their wait`)
      if (unreachable > 0) why.push(`${unreachable} are call-unreachable (${MAX_FAILED_CALL_ATTEMPTS}+ disconnects)`)
      return Response.json({
        error: why.length
          ? `None of these members are callable right now — ${why.join(', ')}. ${
              snoozed > 0 && unreachable === 0
                ? 'Try again once the wait is up, or reach them on chat.'
                : 'Reach them on chat instead.'}`
          : 'None of these members are callable (no Type-B / all do-not-call).',
      }, { status: 400 })
    }

    // Reuse this audience's existing call campaign if it has one — that preserves
    // already-called / DNC card status (task upsert ignores existing), so nobody is
    // re-called. Otherwise create one. Either way it becomes the single live cohort.
    const { data: existingCamp } = await supabaseAdmin.from('wa_b_call_campaigns')
      .select('id').eq('audience_id', audienceId).order('created_at', { ascending: false }).limit(1).maybeSingle()
    await supabaseAdmin.from('wa_b_call_campaigns').update({ is_active: false }).eq('is_active', true)

    let campId = existingCamp?.id as string | undefined
    if (campId) {
      await supabaseAdmin.from('wa_b_call_campaigns').update({ is_active: true }).eq('id', campId)
    } else {
      const { data: camp, error: cErr } = await supabaseAdmin.from('wa_b_call_campaigns')
        .insert({ name: aud.name, filter_json: aud.filter, audience_id: audienceId, created_by: user.id, is_active: true })
        .select('id').single()
      if (cErr || !camp) return Response.json({ error: cErr?.message ?? 'Could not create call cohort.' }, { status: 500 })
      campId = camp.id as string
    }

    let taskCount = 0
    for (let i = 0; i < customerIds.length; i += 500) {
      const chunk = customerIds.slice(i, i + 500).map(cid => ({ campaign_id: campId, customer_id: cid }))
      const { error: tErr } = await supabaseAdmin.from('wa_b_call_tasks')
        .upsert(chunk, { onConflict: 'campaign_id,customer_id', ignoreDuplicates: true })
      if (tErr) return Response.json({ error: tErr.message }, { status: 500 })
      taskCount += chunk.length
    }
    return Response.json({ channel: 'call', campaignId: campId, taskCount, callable: customerIds.length, unreachable, snoozed, members: phones.length })
  }

  return Response.json({ error: 'Pick a channel (chat or call).' }, { status: 400 })
}
