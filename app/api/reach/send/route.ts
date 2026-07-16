import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendTemplateMessage } from '@/lib/whatsapp/api'

// Reach — send an approved template to a reviewed cohort.
//   POST { recipients:[{phone,name?}], templateId, cohortLabel?, campaignRef? }
// For each phone (server re-verifies, never trusts the client):
//   1. skip if opted out (STOP / DNC)                    -> skipped_dnc
//   2. skip if same template sent within its window      -> skipped_suppressed  (SAVES MONEY)
//   3. send template, thread it (replies land in inbox), ledger it
// Daily-rate templates (suppression_days = 0) never suppress.

interface Recipient { phone: string; name?: string | null }

function tenDigit(raw: string): string {
  const d = (raw ?? '').replace(/\D/g, '')
  return d.length > 10 && d.startsWith('91') ? d.slice(-10) : d
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

  const { recipients, templateId, cohortLabel, campaignRef, ignoreSuppression, filter } = (await req.json()) as {
    recipients?: Recipient[]; templateId?: string; cohortLabel?: string; campaignRef?: string; ignoreSuppression?: boolean; filter?: unknown
  }
  if (!templateId) return Response.json({ error: 'templateId required' }, { status: 400 })
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return Response.json({ error: 'No recipients' }, { status: 400 })
  }

  // Template.
  const { data: template } = await supabaseAdmin
    .from('wa_message_templates').select('*').eq('id', templateId).single()
  if (!template) return Response.json({ error: 'Template not found' }, { status: 404 })
  if (!template.meta_template_name) {
    return Response.json({ error: 'This template has no Meta-approved template linked — cannot send to cold contacts.' }, { status: 400 })
  }
  const suppKey: string = template.suppression_bucket || template.id
  const suppDays: number = template.suppression_days ?? 0

  // De-dupe recipients by phone.
  const byPhone = new Map<string, Recipient>()
  for (const r of recipients) {
    const p = tenDigit(r.phone)
    if (p.length === 10 && !byPhone.has(p)) byPhone.set(p, { phone: p, name: r.name ?? null })
  }
  const phones = [...byPhone.keys()]

  // Today's rates for rate placeholders.
  const todayStr = new Date().toLocaleDateString('en-CA')
  const { data: rates } = await supabaseAdmin
    .from('daily_rates').select('rate_24kt, rate_22kt, rate_18kt').eq('date', todayStr).maybeSingle()

  // Unified opt-out from the contact spine (STOP ∪ DNC) + display-name fallback.
  const optedOut = new Set<string>()
  const nameByPhone = new Map<string, string>()
  for (let i = 0; i < phones.length; i += 300) {
    const { data } = await supabaseAdmin.from('contacts')
      .select('phone, name, name_override, is_opted_out').in('phone', phones.slice(i, i + 300))
    for (const r of (data ?? []) as Array<{ phone: string; name: string | null; name_override: string | null; is_opted_out: boolean }>) {
      const p = tenDigit(r.phone)
      if (r.is_opted_out) optedOut.add(p)
      const nm = (r.name_override || r.name || '').trim()
      if (nm && nm !== 'Unknown') nameByPhone.set(p, nm)
    }
  }

  // Suppression set — phones that already got this template-key within the window.
  // A manual/test send can opt out of the guard (still respects DNC/opt-out).
  const suppSet = new Set<string>()
  if (suppDays > 0 && !ignoreSuppression) {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - suppDays)
    for (let i = 0; i < phones.length; i += 300) {
      const { data } = await supabaseAdmin.from('wa_send_ledger').select('phone')
        .in('phone', phones.slice(i, i + 300)).eq('status', 'sent')
        .eq('suppression_key', suppKey).gte('sent_at', cutoff.toISOString())
      for (const r of (data ?? []) as { phone: string }[]) suppSet.add(tenDigit(r.phone))
    }
  }

  // Build Meta components for one recipient.
  function components(name: string) {
    const vars = (template.meta_variables as string[] | null) ?? []
    const parameters = vars.map(v => {
      const k = v.toLowerCase()
      if (k === 'name') return { type: 'text', parameter_name: 'customer_name', text: name || 'there' }
      if (k === 'rate_24kt') return { type: 'text', text: rates?.rate_24kt != null ? String(rates.rate_24kt) : '—' }
      if (k === 'rate_22kt') return { type: 'text', text: rates?.rate_22kt != null ? String(rates.rate_22kt) : '—' }
      if (k === 'rate_18kt') return { type: 'text', text: rates?.rate_18kt != null ? String(rates.rate_18kt) : '—' }
      return { type: 'text', text: '' }
    })
    const comps: object[] = []
    if (template.header_type === 'image' && template.header_image_url) {
      comps.push({ type: 'header', parameters: [{ type: 'image', image: { link: template.header_image_url } }] })
    }
    if (parameters.length) comps.push({ type: 'body', parameters })
    return comps
  }

  // Campaign run (wa_036) — anchors this send for the funnel report. Defensive:
  // if the table isn't there yet, campaignId stays null and ledger rows omit it.
  let campaignId: string | null = null
  {
    const { data: camp, error } = await supabaseAdmin.from('wa_campaigns').insert({
      cohort_label: cohortLabel ?? null, template_id: template.id, template_name: template.name,
      meta_template_name: template.meta_template_name, category: template.category ?? 'custom',
      filter: filter ?? null, sent_by: user.id,
    }).select('id').single()
    if (!error) campaignId = camp?.id ?? null
  }
  const campaignField = campaignId ? { campaign_id: campaignId } : {}

  const now = new Date().toISOString()
  let sent = 0, failed = 0, skippedSuppressed = 0, skippedDnc = 0
  const results: Array<{ phone: string; status: string; error?: string }> = []
  const ledgerRows: Array<Record<string, unknown>> = []

  for (const p of phones) {
    const name = (byPhone.get(p)?.name ?? '').trim() || (nameByPhone.get(p) ?? '')

    if (optedOut.has(p)) {
      skippedDnc++; results.push({ phone: p, status: 'skipped_dnc' }); continue
    }
    if (suppSet.has(p)) {
      skippedSuppressed++; results.push({ phone: p, status: 'skipped_suppressed' }); continue
    }

    try {
      const wamid = await sendTemplateMessage(p, template.meta_template_name, template.meta_template_lang ?? 'en', components(name))

      // Thread it so a reply shows in the inbox with this context.
      const { data: thread } = await supabaseAdmin.from('wa_threads')
        .upsert({ phone: p, customer_name: name || null, last_message_at: now,
          last_message_preview: (template.name || 'Template message').slice(0, 60) }, { onConflict: 'phone' })
        .select('id').single()
      if (thread) {
        await supabaseAdmin.from('wa_messages').insert({
          thread_id: thread.id, direction: 'outbound', wa_message_id: wamid,
          body: null, template_name: template.name, status: 'sent', sent_at: now, sent_by: user.id,
        })
      }

      ledgerRows.push({
        phone: p, template_id: template.id, meta_template_name: template.meta_template_name,
        suppression_key: suppKey, category: template.category ?? 'custom', status: 'sent',
        wa_message_id: wamid, campaign_ref: campaignRef ?? null, cohort_label: cohortLabel ?? null, sent_by: user.id,
        ...campaignField,
      })
      sent++; results.push({ phone: p, status: 'sent' })
    } catch (err) {
      const msg = (err as Error).message
      ledgerRows.push({
        phone: p, template_id: template.id, meta_template_name: template.meta_template_name,
        suppression_key: suppKey, category: template.category ?? 'custom', status: 'failed',
        campaign_ref: campaignRef ?? null, cohort_label: cohortLabel ?? null, error: msg, sent_by: user.id,
        ...campaignField,
      })
      failed++; results.push({ phone: p, status: 'failed', error: msg })
    }
  }

  if (ledgerRows.length) await supabaseAdmin.from('wa_send_ledger').insert(ledgerRows)

  // Finalise campaign counts.
  if (campaignId) {
    await supabaseAdmin.from('wa_campaigns').update({
      total: phones.length, sent, failed, skipped_suppressed: skippedSuppressed, skipped_dnc: skippedDnc,
    }).eq('id', campaignId)
  }

  return Response.json({
    sent, failed, skippedSuppressed, skippedDnc, total: phones.length, results, campaignId,
  })
}
