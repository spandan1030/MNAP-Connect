import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { dispatchTemplate, type DispatchRecipient } from '@/lib/reach/dispatch'

// Reach quick-send — dispatch an approved template to a reviewed list and record
// it as a campaign run (funnel report). Still used by the thank-you flow.
// Cohort membership / send-more lives in the campaigns endpoints; this is the
// fire-once path. The actual send loop is shared (lib/reach/dispatch).
//   POST { recipients:[{phone,name?}], templateId, cohortLabel?, campaignRef?, ignoreSuppression?, filter? }

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { recipients, templateId, cohortLabel, campaignRef, ignoreSuppression, filter } = (await req.json()) as {
    recipients?: DispatchRecipient[]; templateId?: string; cohortLabel?: string; campaignRef?: string; ignoreSuppression?: boolean; filter?: unknown
  }
  if (!templateId) return Response.json({ error: 'templateId required' }, { status: 400 })
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return Response.json({ error: 'No recipients' }, { status: 400 })
  }

  const { data: template } = await supabaseAdmin
    .from('wa_message_templates').select('id, name, meta_template_name, category').eq('id', templateId).single()
  if (!template) return Response.json({ error: 'Template not found' }, { status: 404 })

  // Campaign run (funnel anchor). Defensive: omit campaign_id if the table isn't there.
  let campaignId: string | null = null
  {
    const { data: camp, error } = await supabaseAdmin.from('wa_campaigns').insert({
      cohort_label: cohortLabel ?? null, name: cohortLabel ?? null,
      template_id: template.id, template_name: template.name,
      meta_template_name: template.meta_template_name, category: template.category ?? 'custom',
      filter: filter ?? null, sent_by: user.id,
    }).select('id').single()
    if (!error) campaignId = camp?.id ?? null
  }

  const result = await dispatchTemplate({
    templateId, recipients, userId: user.id, campaignId,
    cohortLabel: cohortLabel ?? null, campaignRef: campaignRef ?? null, ignoreSuppression,
  })
  if (result.error) return Response.json({ error: result.error }, { status: 400 })

  if (campaignId) {
    await supabaseAdmin.from('wa_campaigns').update({
      total: result.total, sent: result.sent, failed: result.failed,
      skipped_suppressed: result.skippedSuppressed, skipped_dnc: result.skippedDnc,
    }).eq('id', campaignId)
  }

  return Response.json({
    sent: result.sent, failed: result.failed, skippedSuppressed: result.skippedSuppressed,
    skippedDnc: result.skippedDnc, total: result.total, results: result.results, campaignId,
  })
}
