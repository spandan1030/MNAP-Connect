import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { resolveCohortPhones, tenDigit } from '@/lib/reach/resolve'
import { resolveRuleTree } from '@/lib/audiences/resolve-rules'
import { isEmptyTree, type RuleTree } from '@/lib/audiences/rules'
import { dispatchTemplate } from '@/lib/reach/dispatch'
import { callableTypeB, notCallableMessage, mintCallDeck } from '@/lib/calls/deck'
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

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { audienceId, channel, templateId, subFilter, subRules, limit } = (await req.json().catch(() => ({}))) as {
    audienceId?: string; channel?: 'chat' | 'call'; templateId?: string
    subFilter?: ReachFilter; subRules?: RuleTree; limit?: number
  }
  if (!audienceId) return Response.json({ error: 'Missing audienceId' }, { status: 400 })

  const { data: aud } = await supabaseAdmin.from('wa_audiences')
    .select('id, name, filter').eq('id', audienceId).maybeSingle()
  if (!aud) return Response.json({ error: 'Audience not found' }, { status: 404 })

  // Members, optionally narrowed by a send-time sub-filter (AND). The narrowing
  // uses the SAME two faces as authoring: subRules (rule tree from the Rules or
  // Chips builder) resolves through the one engine; subFilter is the legacy chip
  // shape, still accepted so older callers keep working. Neither changes the
  // saved audience — this is a send-time slice only.
  let phones = await memberPhones(audienceId)
  if (subRules && !isEmptyTree(subRules)) {
    const { phones: subSet, error } = await resolveRuleTree(subRules)
    if (error) return Response.json({ error }, { status: 400 })
    phones = phones.filter(p => subSet.has(p))
  } else if (subFilter && Object.keys(subFilter).length > 0) {
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
    // Same shared deck logic Call Control uses — one definition of "callable"
    // and one way to mint the deck.
    const { ids, unreachable, snoozed } = await callableTypeB(new Set(phones.map(tenDigit)))
    if (ids.length === 0) {
      return Response.json({ error: notCallableMessage(snoozed, unreachable) }, { status: 400 })
    }
    // reuseForAudienceId preserves already-called / DNC cards on re-push.
    const res = await mintCallDeck({
      name: aud.name, customerIds: ids, createdBy: user.id,
      audienceId, filterJson: aud.filter, reuseForAudienceId: audienceId,
    })
    if ('error' in res) return Response.json({ error: res.error }, { status: 500 })
    return Response.json({ channel: 'call', campaignId: res.campaignId, taskCount: res.taskCount, callable: ids.length, unreachable, snoozed, members: phones.length })
  }

  return Response.json({ error: 'Pick a channel (chat or call).' }, { status: 400 })
}
