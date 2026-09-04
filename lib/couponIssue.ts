import { supabaseAdmin } from '@/lib/supabase/admin'
import { tenDigit } from '@/lib/reach/resolve'
import { generateCouponCode, couponState } from '@/lib/coupons'
import type { WaCoupon } from '@/lib/types'

// Issue coupons from one offer to a set of recipients. Shared by the "generate"
// and "generate + send" routes so there's ONE place that mints codes.
//   · pairs a unique code to each phone
//   · won't mint a second STILL-USABLE coupon from the same offer for the same
//     phone — but a prior coupon that has expired / been redeemed / voided does
//     NOT block a fresh issue (so a yearly birthday offer can be sent again).
//   · status starts 'issued'; the send route later flips it to 'sent' + clock
export interface IssueRecipient { phone: string; name?: string | null; occasion?: string | null }
export interface IssueResult {
  created: WaCoupon[]
  skipped: Array<{ phone: string; reason: string }>
}

export async function issueCoupons(offerId: string, recipients: IssueRecipient[], userId: string): Promise<IssueResult> {
  const created: WaCoupon[] = []
  const skipped: IssueResult['skipped'] = []

  // De-dupe + validate phones.
  const byPhone = new Map<string, IssueRecipient>()
  for (const r of recipients) {
    const p = tenDigit(r.phone)
    if (p.length !== 10) { skipped.push({ phone: r.phone, reason: 'invalid_phone' }); continue }
    if (!byPhone.has(p)) byPhone.set(p, { ...r, phone: p })
  }
  const phones = [...byPhone.keys()]
  if (phones.length === 0) return { created, skipped }

  // Who already holds a STILL-USABLE coupon from this offer? issued, or sent and
  // not yet expired. Expired / redeemed / void ones don't count, so the same
  // offer can be re-issued to them later (e.g. next year's birthday).
  const live = new Set<string>()
  for (let i = 0; i < phones.length; i += 300) {
    const { data } = await supabaseAdmin.from('wa_coupons').select('phone, status, valid_until')
      .eq('offer_id', offerId).in('status', ['issued', 'sent']).in('phone', phones.slice(i, i + 300))
    for (const r of (data ?? []) as Array<{ phone: string; status: string; valid_until: string | null }>) {
      const s = couponState(r)
      if (s === 'issued' || s === 'sent') live.add(tenDigit(r.phone)) // 'sent' from couponState = not expired
    }
  }

  for (const p of phones) {
    if (live.has(p)) { skipped.push({ phone: p, reason: 'already_has_live_coupon' }); continue }
    const r = byPhone.get(p)!
    let inserted: WaCoupon | null = null
    // Retry on the rare code collision (unique code index).
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      const { data, error } = await supabaseAdmin.from('wa_coupons').insert({
        code: generateCouponCode(), offer_id: offerId, phone: p,
        customer_name: (r.name ?? '').trim() || null,
        occasion: r.occasion ?? null, status: 'issued', issued_by: userId,
      }).select('*').single()
      if (!error && data) { inserted = data as WaCoupon; break }
      const msg = error?.message ?? ''
      // A code collision (unique `code`) → loop and try a fresh code. Any other
      // error → report it once and stop retrying this recipient.
      if (!/wa_coupons_code_key|duplicate key/i.test(msg)) {
        skipped.push({ phone: p, reason: msg || 'insert_failed' }); break
      }
    }
    if (inserted) created.push(inserted)
  }

  return { created, skipped }
}
