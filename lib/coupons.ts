// Coupon engine — shared vocabulary and helpers used by the API routes and the
// admin UI. Keep the client-safe helpers (labels, formatting, derived state)
// here; the DB writes live in the routes.

export const COUPON_VALID_DAYS = 30 // fixed validity window from send (owner decision)

export type DiscountType = 'making_pct' | 'free_gift' | 'flat_amount' | 'total_pct' | 'custom'
export type CouponStatus = 'issued' | 'sent' | 'redeemed' | 'void'
// 'expired' is not a stored status — it's derived from valid_until.
export type CouponState = CouponStatus | 'expired'

export const DISCOUNT_TYPE_LABEL: Record<DiscountType, string> = {
  making_pct: '% off making charges',
  free_gift: 'Free gift',
  flat_amount: 'Flat ₹ off',
  total_pct: '% off total',
  custom: 'Custom',
}

export const OCCASION_LABEL: Record<string, string> = {
  birthday: 'Birthday',
  anniversary: 'Anniversary',
}

export const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

// The customer-facing offer line. Prefer the explicit offer_text; fall back to a
// sensible auto-string from type + value so an offer is never blank.
export function offerLine(o: { discount_type: string; discount_value: number | null; offer_text: string | null }): string {
  if (o.offer_text && o.offer_text.trim()) return o.offer_text.trim()
  const v = o.discount_value
  switch (o.discount_type) {
    case 'making_pct': return v != null ? `${v}% off making charges` : 'Off making charges'
    case 'total_pct':  return v != null ? `${v}% off total` : 'Discount on total'
    case 'flat_amount': return v != null ? `₹${Math.round(v).toLocaleString('en-IN')} off` : 'Flat discount'
    case 'free_gift':  return 'Free gift'
    default:           return 'Special offer'
  }
}

// Unambiguous alphabet (no O/0, I/1) so codes are easy to read aloud / type.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function generateCouponCode(prefix = 'MNAP'): string {
  let body = ''
  for (let i = 0; i < 5; i++) body += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  return `${prefix}-${body}`
}

// Derived lifecycle state, honouring expiry. A coupon that was 'sent' but whose
// window has passed reads as 'expired' — the source of truth for "is it valid?".
export function couponState(c: { status: string; valid_until: string | null }): CouponState {
  if (c.status === 'redeemed' || c.status === 'void') return c.status
  if (c.valid_until && new Date(c.valid_until).getTime() < Date.now()) return 'expired'
  return c.status as CouponState
}

export function isRedeemable(c: { status: string; valid_until: string | null }): boolean {
  return couponState(c) === 'sent'
}

export const STATE_LABEL: Record<CouponState, string> = {
  issued: 'Not sent', sent: 'Active', redeemed: 'Redeemed', void: 'Void', expired: 'Expired',
}
export const STATE_TONE: Record<CouponState, string> = {
  issued: 'gray', sent: 'green', redeemed: 'blue', void: 'gray', expired: 'amber',
}
