import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendTemplateMessage } from '@/lib/whatsapp/api'
import { publishInvoice, type InvoiceSnapshot } from '@/lib/invoices/publish'
import { applyPlaceholders } from '@/lib/utils'

// Send the invoice-link message for a set of imported-but-unsent bills. Per
// INVOICE (not per phone) — a customer with two new bills gets two links. For
// each one, in order:
//   1. skip if opted out (STOP / DNC / manual)
//   2. PUBLISH the snapshot to the customer app (Firestore) — if this fails, we
//      do NOT send, so a dead link can never go out
//   3. send the Utility template with the dynamic URL button carrying the token
//   4. thread it (replies land in the inbox) + ledger it
//   5. stamp sent_at / published_at / expires_at (now + 7 days) on wa_invoices
//
// Suppression here is by wa_invoices.sent_at (we only load unsent bills), NOT the
// template resend window — every bill is a distinct, one-time message.
//   POST { invoiceIds:[uuid], templateId, cohortLabel? }

const EXPIRY_DAYS = 7

function tenDigit(raw: string): string {
  const d = (raw ?? '').replace(/\D/g, '')
  return d.length > 10 && d.startsWith('91') ? d.slice(-10) : d
}

// The single rolling "Invoice links" campaign (one row, all sends accumulate into
// it). Reused across sends; created on the first ever invoice send. Fail-soft:
// null just means this batch isn't linked into the report (the send still happens).
async function getInvoiceCampaignId(
  templateName: string | null, metaName: string | null, userId: string,
): Promise<string | null> {
  const { data: existing } = await supabaseAdmin.from('wa_campaigns')
    .select('id').eq('category', 'invoice').order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (existing?.id) return existing.id as string
  const { data: created } = await supabaseAdmin.from('wa_campaigns').insert({
    name: 'Invoice links', cohort_label: 'Invoice links', category: 'invoice',
    template_name: templateName, meta_template_name: metaName, is_dynamic: false, sent_by: userId,
  }).select('id').single()
  return (created?.id as string) ?? null
}

interface InvoiceRow {
  id: string; bill_no: string; token: string; phone: string; customer_name: string | null
  invoice_date: string | null; amount_before_tax: number | null; tax_amount: number | null
  net_amount: number | null; old_metal_amount: number | null; advance_amount: number | null
  payable: number | null; line_items: unknown
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

  const { invoiceIds, templateId, cohortLabel } = (await req.json()) as {
    invoiceIds?: string[]; templateId?: string; cohortLabel?: string
  }
  if (!templateId) return Response.json({ error: 'templateId required' }, { status: 400 })
  if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
    return Response.json({ error: 'No invoices selected' }, { status: 400 })
  }

  const { data: template } = await supabaseAdmin
    .from('wa_message_templates').select('*').eq('id', templateId).single()
  if (!template) return Response.json({ error: 'Template not found' }, { status: 404 })
  if (!template.meta_template_name) {
    return Response.json({ error: 'This template has no Meta-approved template linked.' }, { status: 400 })
  }

  // One rolling "Invoice links" campaign — every invoice send accumulates into it,
  // so the send shows up in the Campaigns list + funnel (sent → delivered → read →
  // replied) with the standard insights. Get-or-create by category='invoice'.
  const invoiceCampaignId = await getInvoiceCampaignId(
    (template.name as string) ?? null, (template.meta_template_name as string) ?? null, user.id,
  )

  // Load the chosen invoices — server-authoritative (never trust client amounts),
  // and only those still unsent (guards against a double-send from a stale UI).
  const { data: invData, error: invErr } = await supabaseAdmin
    .from('wa_invoices')
    .select('id, bill_no, token, phone, customer_name, invoice_date, amount_before_tax, tax_amount, net_amount, old_metal_amount, advance_amount, payable, line_items')
    .in('id', invoiceIds).is('sent_at', null)
  if (invErr) return Response.json({ error: invErr.message }, { status: 500 })
  const invoices = (invData ?? []) as InvoiceRow[]
  if (invoices.length === 0) return Response.json({ sent: 0, failed: 0, skippedDnc: 0, total: 0 })

  // Opt-out set from the contact spine.
  const phones = [...new Set(invoices.map(i => tenDigit(i.phone)))]
  const optedOut = new Set<string>()
  for (let i = 0; i < phones.length; i += 300) {
    const { data: c } = await supabaseAdmin.from('contacts').select('phone')
      .eq('is_opted_out', true).in('phone', phones.slice(i, i + 300))
    for (const r of (c ?? []) as { phone: string }[]) optedOut.add(tenDigit(r.phone))
  }

  // Body params from the template's declared variables (invoice templates use
  // name / bill_no / payable). The dynamic URL button always carries the token.
  const vars = (template.meta_variables as string[] | null) ?? []
  function bodyParams(inv: InvoiceRow) {
    const name = (inv.customer_name || '').trim() || 'there'
    return vars.map(v => {
      const k = v.toLowerCase()
      if (k === 'name') return { type: 'text', text: name }
      if (k === 'bill_no' || k === 'bill') return { type: 'text', text: inv.bill_no }
      if (k === 'payable' || k === 'amount') return { type: 'text', text: inv.payable != null ? String(inv.payable) : '' }
      return { type: 'text', text: '' }
    })
  }
  function components(inv: InvoiceRow) {
    const comps: object[] = []
    if (template.header_type === 'image' && template.header_image_url) {
      comps.push({ type: 'header', parameters: [{ type: 'image', image: { link: template.header_image_url } }] })
    }
    const bp = bodyParams(inv)
    if (bp.length) comps.push({ type: 'body', parameters: bp })
    // Dynamic URL button: template URL is …/i/{{1}}, the token fills {{1}}.
    comps.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: inv.token }] })
    return comps
  }

  const now = new Date().toISOString()
  const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 86400_000).toISOString()
  const ledgerRows: Array<Record<string, unknown>> = []
  const results: Array<{ billNo: string; status: string; error?: string }> = []
  const sentMembers = new Map<string, string | null>() // phone -> name, for wa_campaign_members
  let sent = 0, failed = 0, skippedDnc = 0

  for (const inv of invoices) {
    const p = tenDigit(inv.phone)
    if (optedOut.has(p)) { skippedDnc++; results.push({ billNo: inv.bill_no, status: 'skipped_dnc' }); continue }

    // 2. Publish first — a failure here means we never send a link to a missing page.
    const snapshot: InvoiceSnapshot = {
      bill_no: inv.bill_no, invoice_date: inv.invoice_date, customer_name: inv.customer_name,
      amount_before_tax: inv.amount_before_tax, tax_amount: inv.tax_amount, net_amount: inv.net_amount,
      old_metal_amount: inv.old_metal_amount, advance_amount: inv.advance_amount,
      payable: inv.payable, line_items: inv.line_items,
    }
    try {
      await publishInvoice(inv.token, snapshot, expiresAt)
    } catch (err) {
      failed++; results.push({ billNo: inv.bill_no, status: 'publish_failed', error: (err as Error).message })
      continue
    }

    // 3. Send the template with the token button.
    try {
      const wamid = await sendTemplateMessage(p, template.meta_template_name, template.meta_template_lang ?? 'en', components(inv))
      const renderedBody = applyPlaceholders(template.body_text ?? '', (inv.customer_name || 'there'), null).trim()
        || (template.name || 'Invoice')

      const { data: thread } = await supabaseAdmin.from('wa_threads')
        .upsert({ phone: p, customer_name: inv.customer_name || null, last_message_at: now,
          last_message_preview: renderedBody.slice(0, 60) }, { onConflict: 'phone' })
        .select('id').single()
      if (thread) {
        await supabaseAdmin.from('wa_messages').insert({
          thread_id: thread.id, direction: 'outbound', message_type: 'text', wa_message_id: wamid,
          body: renderedBody, template_name: template.name, status: 'sent', sent_at: now, sent_by: user.id,
        })
      }

      ledgerRows.push({
        phone: p, template_id: template.id, meta_template_name: template.meta_template_name,
        suppression_key: `invoice:${inv.bill_no}`, category: 'invoice', status: 'sent',
        wa_message_id: wamid, cohort_label: cohortLabel ?? 'Invoice link', sent_by: user.id,
        campaign_id: invoiceCampaignId,
      })

      // 5. Stamp the lifecycle — this bill leaves the pending queue. Also record the
      //    wamid (so delivery/read events attribute to this bill) + the campaign link.
      await supabaseAdmin.from('wa_invoices')
        .update({ sent_at: now, published_at: now, expires_at: expiresAt, wa_message_id: wamid, campaign_id: invoiceCampaignId })
        .eq('id', inv.id)

      sentMembers.set(p, inv.customer_name || null)
      sent++; results.push({ billNo: inv.bill_no, status: 'sent' })
    } catch (err) {
      const msg = (err as Error).message
      ledgerRows.push({
        phone: p, template_id: template.id, meta_template_name: template.meta_template_name,
        suppression_key: `invoice:${inv.bill_no}`, category: 'invoice', status: 'failed',
        cohort_label: cohortLabel ?? 'Invoice link', error: msg, sent_by: user.id,
        campaign_id: invoiceCampaignId,
      })
      failed++; results.push({ billNo: inv.bill_no, status: 'failed', error: msg })
      // Leave sent_at null so a fixed template / transient error can be retried.
    }
  }

  if (ledgerRows.length) await supabaseAdmin.from('wa_send_ledger').insert(ledgerRows)

  // Roll this batch into the "Invoice links" campaign: add the recipients as
  // members (deduped by phone) and bump the summary counts the list view shows.
  // Fail-soft — a reporting hiccup must never fail a send that already happened.
  if (invoiceCampaignId && sentMembers.size) {
    const memberRows = [...sentMembers.entries()].map(([phone, name]) => ({ campaign_id: invoiceCampaignId, phone, name }))
    await supabaseAdmin.from('wa_campaign_members').upsert(memberRows, { onConflict: 'campaign_id,phone' })
  }
  if (invoiceCampaignId && (sent || failed)) {
    const { data: cur } = await supabaseAdmin.from('wa_campaigns')
      .select('total, sent, failed').eq('id', invoiceCampaignId).maybeSingle()
    await supabaseAdmin.from('wa_campaigns').update({
      total:  ((cur?.total  as number) ?? 0) + sent + failed,
      sent:   ((cur?.sent   as number) ?? 0) + sent,
      failed: ((cur?.failed as number) ?? 0) + failed,
    }).eq('id', invoiceCampaignId)
  }

  return Response.json({ sent, failed, skippedDnc, total: invoices.length, results })
}
