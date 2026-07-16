import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendTemplateMessage } from '@/lib/whatsapp/api'
import { applyPlaceholders } from '@/lib/utils'
import { tenDigit } from '@/lib/reach/resolve'

// Template dispatch — the ONE place that actually sends an approved template to a
// list of phones. Used by Reach (initial blast), Campaigns (send-more), and the
// thank-you flow. For each phone (server re-verifies, never trusts the client):
//   1. skip if opted out (STOP / DNC / manual)      -> skippedDnc
//   2. skip if same template sent within its window -> skippedSuppressed (saves money)
//   3. send, thread it (replies land in inbox), ledger it (stamped campaign_id)

export interface DispatchRecipient { phone: string; name?: string | null }

export interface DispatchResult {
  error?: string
  sent: number; failed: number; skippedSuppressed: number; skippedDnc: number; total: number
  eligibleRemaining: number    // eligible but not sent this batch (cap left them for next time)
  sentPhones: string[]
  results: Array<{ phone: string; status: string; error?: string }>
}

export async function dispatchTemplate(opts: {
  templateId: string
  recipients: DispatchRecipient[]
  userId: string
  campaignId?: string | null
  cohortLabel?: string | null
  campaignRef?: string | null
  ignoreSuppression?: boolean
  limit?: number | null        // send to at most N ELIGIBLE this batch (rest stay pending)
}): Promise<DispatchResult> {
  const empty: DispatchResult = { sent: 0, failed: 0, skippedSuppressed: 0, skippedDnc: 0, total: 0, eligibleRemaining: 0, sentPhones: [], results: [] }

  const { data: template } = await supabaseAdmin
    .from('wa_message_templates').select('*').eq('id', opts.templateId).single()
  if (!template) return { ...empty, error: 'Template not found' }
  if (!template.meta_template_name) return { ...empty, error: 'This template has no Meta-approved template linked.' }

  const suppKey: string = template.suppression_bucket || template.id
  const suppDays: number = template.suppression_days ?? 0

  // De-dupe recipients by phone.
  const byPhone = new Map<string, DispatchRecipient>()
  for (const r of opts.recipients) {
    const p = tenDigit(r.phone)
    if (p.length === 10 && !byPhone.has(p)) byPhone.set(p, { phone: p, name: r.name ?? null })
  }
  const phones = [...byPhone.keys()]
  if (phones.length === 0) return empty

  // Today's rates for rate placeholders.
  const todayStr = new Date().toLocaleDateString('en-CA')
  const { data: rates } = await supabaseAdmin
    .from('daily_rates').select('rate_24kt, rate_22kt, rate_18kt').eq('date', todayStr).maybeSingle()

  // Unified opt-out (STOP ∪ DNC ∪ manual) + display name from the contact spine.
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
  const suppSet = new Set<string>()
  if (suppDays > 0 && !opts.ignoreSuppression) {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - suppDays)
    for (let i = 0; i < phones.length; i += 300) {
      const { data } = await supabaseAdmin.from('wa_send_ledger').select('phone')
        .in('phone', phones.slice(i, i + 300)).eq('status', 'sent')
        .eq('suppression_key', suppKey).gte('sent_at', cutoff.toISOString())
      for (const r of (data ?? []) as { phone: string }[]) suppSet.add(tenDigit(r.phone))
    }
  }

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

  const campaignField = opts.campaignId ? { campaign_id: opts.campaignId } : {}
  const now = new Date().toISOString()
  const results: DispatchResult['results'] = []
  const sentPhones: string[] = []
  const ledgerRows: Array<Record<string, unknown>> = []

  // Partition: opted-out and suppressed are recorded as skips; the rest are
  // eligible. A cap sends only the first N eligible — the others stay pending.
  const skippedDnc = phones.filter(p => optedOut.has(p)).length
  for (const p of phones) if (optedOut.has(p)) results.push({ phone: p, status: 'skipped_dnc' })
  const skippedSuppressed = phones.filter(p => !optedOut.has(p) && suppSet.has(p)).length
  for (const p of phones) if (!optedOut.has(p) && suppSet.has(p)) results.push({ phone: p, status: 'skipped_suppressed' })

  const eligible = phones.filter(p => !optedOut.has(p) && !suppSet.has(p))
  const toSend = opts.limit != null ? eligible.slice(0, Math.max(0, opts.limit)) : eligible
  const eligibleRemaining = eligible.length - toSend.length

  let sent = 0, failed = 0

  for (const p of toSend) {
    const name = (byPhone.get(p)?.name ?? '').trim() || (nameByPhone.get(p) ?? '')

    try {
      const wamid = await sendTemplateMessage(p, template.meta_template_name, template.meta_template_lang ?? 'en', components(name))
      const renderedBody = (applyPlaceholders(template.body_text ?? '', name || 'there', rates ?? null).trim())
        || (template.name || 'Template message')

      const { data: thread } = await supabaseAdmin.from('wa_threads')
        .upsert({ phone: p, customer_name: name || null, last_message_at: now,
          last_message_preview: renderedBody.slice(0, 60) }, { onConflict: 'phone' })
        .select('id').single()
      if (thread) {
        await supabaseAdmin.from('wa_messages').insert({
          thread_id: thread.id, direction: 'outbound', message_type: 'text', wa_message_id: wamid,
          body: renderedBody, template_name: template.name, status: 'sent', sent_at: now, sent_by: opts.userId,
        })
      }

      ledgerRows.push({
        phone: p, template_id: template.id, meta_template_name: template.meta_template_name,
        suppression_key: suppKey, category: template.category ?? 'custom', status: 'sent',
        wa_message_id: wamid, campaign_ref: opts.campaignRef ?? null, cohort_label: opts.cohortLabel ?? null, sent_by: opts.userId,
        ...campaignField,
      })
      sent++; sentPhones.push(p); results.push({ phone: p, status: 'sent' })
    } catch (err) {
      const msg = (err as Error).message
      ledgerRows.push({
        phone: p, template_id: template.id, meta_template_name: template.meta_template_name,
        suppression_key: suppKey, category: template.category ?? 'custom', status: 'failed',
        campaign_ref: opts.campaignRef ?? null, cohort_label: opts.cohortLabel ?? null, error: msg, sent_by: opts.userId,
        ...campaignField,
      })
      failed++; results.push({ phone: p, status: 'failed', error: msg })
    }
  }

  if (ledgerRows.length) await supabaseAdmin.from('wa_send_ledger').insert(ledgerRows)

  return { sent, failed, skippedSuppressed, skippedDnc, total: phones.length, eligibleRemaining, sentPhones, results }
}
