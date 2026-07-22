import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { resolveCohortPhones, tenDigit } from '@/lib/reach/resolve'
import { dispatchTemplate } from '@/lib/reach/dispatch'
import { createAudienceFromCohort, adoptChatCampaignAsStep } from '@/lib/audiences/adhoc'
import type { ReachFilter } from '@/lib/types'

// Create a campaign from a Reach cohort: resolve ALL eligible into members, then
// optionally blast the first N. The rest stay as members to finish later from the
// campaign page.  POST { name, filter, templateId, isDynamic, sendLimit }

async function nameMembers(phones: string[]): Promise<Map<string, string>> {
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

  const { name, filter, templateId, isDynamic, sendLimit, sendPhones } = (await req.json()) as {
    name?: string; filter?: ReachFilter; templateId?: string; isDynamic?: boolean; sendLimit?: number; sendPhones?: string[]
  }
  if (!templateId) return Response.json({ error: 'Pick a template.' }, { status: 400 })
  const f: ReachFilter = filter ?? {}
  const isPaste = !!(f.phones?.length)
  const campaignName = (name ?? '').trim() || 'Untitled campaign'
  // Paste lists are inherently a fixed snapshot; only filter cohorts can be dynamic.
  const dynamic = !!isDynamic && !isPaste

  const { data: template } = await supabaseAdmin
    .from('wa_message_templates').select('id, name, meta_template_name, category').eq('id', templateId).single()
  if (!template) return Response.json({ error: 'Template not found' }, { status: 404 })
  if (!template.meta_template_name) return Response.json({ error: 'This template has no Meta-approved template linked.' }, { status: 400 })

  // Resolve the full cohort → members.
  const { phones: set, error } = await resolveCohortPhones(f)
  if (error) return Response.json({ error }, { status: 400 })
  const memberPhones = [...set]
  if (memberPhones.length === 0) return Response.json({ error: 'That cohort is empty.' }, { status: 400 })

  const names = await nameMembers(memberPhones)

  // Create the campaign.
  const { data: camp, error: cErr } = await supabaseAdmin.from('wa_campaigns').insert({
    name: campaignName, cohort_label: campaignName,
    template_id: template.id, template_name: template.name,
    meta_template_name: template.meta_template_name, category: template.category ?? 'custom',
    filter: f, is_dynamic: dynamic, status: 'active', total: memberPhones.length,
    last_refreshed_at: new Date().toISOString(), sent_by: user.id,
  }).select('id').single()
  if (cErr || !camp) return Response.json({ error: cErr?.message ?? 'Could not create campaign.' }, { status: 500 })
  const campaignId = camp.id as string

  // Insert members.
  for (let i = 0; i < memberPhones.length; i += 500) {
    const rows = memberPhones.slice(i, i + 500).map(p => ({ campaign_id: campaignId, phone: p, name: names.get(p) ?? null }))
    await supabaseAdmin.from('wa_campaign_members').upsert(rows, { onConflict: 'campaign_id,phone' })
  }

  // Optional initial blast: an explicit reviewed selection (sendPhones), else the
  // first N eligible members (sendLimit).
  let send = null
  const explicit = (sendPhones ?? []).map(tenDigit).filter(p => p.length === 10)
  if (explicit.length > 0 || (sendLimit && sendLimit > 0)) {
    const recipients = (explicit.length > 0 ? explicit : memberPhones).map(p => ({ phone: p, name: names.get(p) ?? null }))
    const result = await dispatchTemplate({
      templateId, recipients, userId: user.id, campaignId, cohortLabel: campaignName,
      limit: explicit.length > 0 ? null : sendLimit,
    })
    if (!result.error) {
      await supabaseAdmin.from('wa_campaigns').update({
        sent: result.sent, failed: result.failed,
        skipped_suppressed: result.skippedSuppressed, skipped_dnc: result.skippedDnc,
      }).eq('id', campaignId)
      send = { sent: result.sent, failed: result.failed, skippedSuppressed: result.skippedSuppressed, skippedDnc: result.skippedDnc }
    }
  }

  // Fold into the one spine: this cohort becomes a real AUDIENCE and this blast
  // becomes its step 1, so it can be continued (carry read/replied → narrow →
  // send again) from the audience's funnel. Best-effort — a failure here never
  // fails the send that already happened.
  let audienceId: string | null = null
  try {
    const made = await createAudienceFromCohort({ name: campaignName, phones: memberPhones, filter: f, userId: user.id, isDynamic: dynamic })
    if ('audienceId' in made) {
      audienceId = made.audienceId
      await adoptChatCampaignAsStep({
        audienceId, campaignId, enteredPhones: memberPhones, templateId, name: campaignName, userId: user.id,
      })
    }
  } catch { /* funnel glue is best-effort */ }

  return Response.json({ campaignId, audienceId, members: memberPhones.length, dynamic, send })
}
