import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getRouteUser } from '@/lib/supabase/route'
import { sendTemplateMessage } from '@/lib/whatsapp/api'
import { issueCoupons, type IssueRecipient } from '@/lib/couponIssue'
import { offerLine, couponState, COUPON_VALID_DAYS } from '@/lib/coupons'
import type { WaCoupon, WaCouponOffer, MessageTemplate } from '@/lib/types'

// Send coupon codes on WhatsApp. Two ways in:
//   · { couponIds:[...], templateId? }                 → send existing (issued) coupons
//   · { offerId, recipients:[{phone,name?,occasion?}], templateId? } → issue THEN send
//
// The template is a Meta-approved template with category 'coupon' (auto-picked
// if templateId is omitted). Per-recipient variables are filled from the coupon:
//   name · coupon_code (a.k.a. code) · offer (a.k.a. offer_text) · expiry (a.k.a. valid_until)
// Unlike dispatchTemplate, the code/offer/expiry are per-recipient, so this has
// its own send loop. Opt-out is honoured; the send flips the coupon to 'sent'
// and starts its 30-day clock.

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export async function POST(req: NextRequest) {
  const user = await getRouteUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const b = (await req.json().catch(() => ({}))) as {
    couponIds?: string[]; offerId?: string; recipients?: IssueRecipient[]; templateId?: string
  }

  // 1) Resolve the template (explicit, else the active 'coupon' one).
  const { data: tplRows } = b.templateId
    ? await supabaseAdmin.from('wa_message_templates').select('*').eq('id', b.templateId).limit(1)
    : await supabaseAdmin.from('wa_message_templates').select('*')
        .eq('is_active', true).eq('category', 'coupon').order('created_at', { ascending: false }).limit(1)
  const template = (tplRows?.[0] ?? null) as MessageTemplate | null
  if (!template) return Response.json({ error: 'No coupon template configured. Create one in Templates (category “Coupon”).' }, { status: 400 })
  if (!template.meta_template_name) return Response.json({ error: 'That template has no Meta-approved template linked.' }, { status: 400 })

  // 2) Gather the coupons to send — either issue fresh ones, or load existing.
  let coupons: WaCoupon[] = []
  let issueSkipped: Array<{ phone: string; reason: string }> = []
  if (b.offerId && Array.isArray(b.recipients) && b.recipients.length) {
    const { data: offer } = await supabaseAdmin.from('wa_coupon_offers').select('id, is_active').eq('id', b.offerId).single()
    if (!offer) return Response.json({ error: 'Offer not found' }, { status: 404 })
    if (!offer.is_active) return Response.json({ error: 'That offer is inactive.' }, { status: 400 })
    const r = await issueCoupons(b.offerId, b.recipients, user.id)
    coupons = r.created; issueSkipped = r.skipped
  } else if (Array.isArray(b.couponIds) && b.couponIds.length) {
    const { data } = await supabaseAdmin.from('wa_coupons')
      .select('*, offer:wa_coupon_offers(*)').in('id', b.couponIds)
    coupons = (data ?? []) as WaCoupon[]
  } else {
    return Response.json({ error: 'Provide couponIds, or offerId + recipients.' }, { status: 400 })
  }
  if (coupons.length === 0) return Response.json({ sent: 0, failed: 0, skipped: 0, issueSkipped, results: [] })

  // Need the offer for each coupon (offer_text). Issued-fresh coupons lack the
  // join, so fetch any missing offers once.
  const offerIds = [...new Set(coupons.map(c => c.offer_id))]
  const offerMap = new Map<string, WaCouponOffer>()
  {
    const { data } = await supabaseAdmin.from('wa_coupon_offers').select('*').in('id', offerIds)
    for (const o of (data ?? []) as WaCouponOffer[]) offerMap.set(o.id, o)
  }

  // Opt-out from the contact spine + a display name fallback.
  const phones = [...new Set(coupons.map(c => c.phone))]
  const optedOut = new Set<string>()
  const nameByPhone = new Map<string, string>()
  for (let i = 0; i < phones.length; i += 300) {
    const { data } = await supabaseAdmin.from('contacts')
      .select('phone, name, name_override, is_opted_out').in('phone', phones.slice(i, i + 300))
    for (const r of (data ?? []) as Array<{ phone: string; name: string | null; name_override: string | null; is_opted_out: boolean }>) {
      const p = (r.phone ?? '').replace(/\D/g, '').slice(-10)
      if (r.is_opted_out) optedOut.add(p)
      const nm = (r.name_override || r.name || '').trim()
      if (nm && nm !== 'Unknown') nameByPhone.set(p, nm)
    }
  }

  const suppKey: string = template.suppression_bucket || template.id
  const now = new Date()
  const validUntil = new Date(now.getTime() + COUPON_VALID_DAYS * 24 * 60 * 60 * 1000)

  function components(name: string, code: string, offer: string, expiry: string) {
    const vars = (template!.meta_variables as string[] | null) ?? []
    const parameters = vars.map(v => {
      const k = v.toLowerCase()
      if (k === 'name') return { type: 'text', parameter_name: 'customer_name', text: name || 'there' }
      if (k === 'coupon_code' || k === 'code') return { type: 'text', text: code }
      if (k === 'offer' || k === 'offer_text') return { type: 'text', text: offer }
      if (k === 'expiry' || k === 'valid_until') return { type: 'text', text: expiry }
      return { type: 'text', text: '' }
    })
    const comps: object[] = []
    if (template!.header_type === 'image' && template!.header_image_url) {
      comps.push({ type: 'header', parameters: [{ type: 'image', image: { link: template!.header_image_url } }] })
    }
    if (parameters.length) comps.push({ type: 'body', parameters })
    return comps
  }

  const results: Array<{ code: string; phone: string; status: string; error?: string }> = []
  const ledgerRows: Array<Record<string, unknown>> = []
  let sent = 0, failed = 0, skipped = 0

  for (const c of coupons) {
    const offer = offerMap.get(c.offer_id)
    const state = couponState(c)
    // Only fresh/issued coupons should go out. Already redeemed/void/sent are skipped.
    if (c.status !== 'issued') { skipped++; results.push({ code: c.code, phone: c.phone, status: `skipped_${state}` }); continue }
    if (optedOut.has(c.phone)) { skipped++; results.push({ code: c.code, phone: c.phone, status: 'skipped_opted_out' }); continue }
    if (!offer) { skipped++; results.push({ code: c.code, phone: c.phone, status: 'skipped_no_offer' }); continue }

    const name = (c.customer_name ?? '').trim() || (nameByPhone.get(c.phone) ?? '')
    const line = offerLine(offer)
    const expiry = fmtDate(validUntil)

    try {
      const wamid = await sendTemplateMessage(c.phone, template.meta_template_name!, template.meta_template_lang ?? 'en',
        components(name, c.code, line, expiry))

      await supabaseAdmin.from('wa_coupons').update({
        status: 'sent', sent_at: now.toISOString(), valid_from: now.toISOString(),
        valid_until: validUntil.toISOString(), wa_message_id: wamid,
      }).eq('id', c.id)

      const preview = `🎁 ${line} · Code ${c.code} · valid till ${expiry}`
      const { data: thread } = await supabaseAdmin.from('wa_threads')
        .upsert({ phone: c.phone, customer_name: name || null, last_message_at: now.toISOString(),
          last_message_preview: preview.slice(0, 60) }, { onConflict: 'phone' })
        .select('id').single()
      if (thread) {
        await supabaseAdmin.from('wa_messages').insert({
          thread_id: thread.id, direction: 'outbound', message_type: 'text', wa_message_id: wamid,
          body: preview, template_name: template.name, status: 'sent', sent_at: now.toISOString(), sent_by: user.id,
        })
      }
      ledgerRows.push({
        phone: c.phone, template_id: template.id, meta_template_name: template.meta_template_name,
        suppression_key: suppKey, category: 'coupon', status: 'sent', wa_message_id: wamid,
        cohort_label: `coupon:${offer.name}`, campaign_ref: `coupon:${c.code}`, sent_by: user.id,
      })
      sent++; results.push({ code: c.code, phone: c.phone, status: 'sent' })
    } catch (err) {
      const msg = (err as Error).message
      failed++; results.push({ code: c.code, phone: c.phone, status: 'failed', error: msg })
      ledgerRows.push({
        phone: c.phone, template_id: template.id, meta_template_name: template.meta_template_name,
        suppression_key: suppKey, category: 'coupon', status: 'failed', error: msg,
        cohort_label: `coupon:${offer.name}`, campaign_ref: `coupon:${c.code}`, sent_by: user.id,
      })
    }
  }

  if (ledgerRows.length) await supabaseAdmin.from('wa_send_ledger').insert(ledgerRows)

  return Response.json({ sent, failed, skipped, issueSkipped, total: coupons.length, results })
}
