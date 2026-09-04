import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getRouteUser } from '@/lib/supabase/route'
import { issueCoupons, type IssueRecipient } from '@/lib/couponIssue'
import { couponState } from '@/lib/coupons'

// Coupons — the issued codes.
//   GET  ?status=&offerId=&phone=&occasion=&q=  → list (joined offer), newest first
//        status accepts a lifecycle state incl. derived 'expired' / 'active'(=sent)
//   POST { offerId, recipients:[{phone,name?,occasion?}] } → mint codes (no send)
//   PATCH { id, action:'redeem'|'void'|'reissue_note', ... }

export async function GET(req: NextRequest) {
  const user = await getRouteUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  // Apply all filters first (each returns a FilterBuilder), then order+limit last.
  let q = supabaseAdmin.from('wa_coupons').select('*, offer:wa_coupon_offers(*)')

  const offerId = sp.get('offerId'); if (offerId) q = q.eq('offer_id', offerId)
  const occasion = sp.get('occasion'); if (occasion) q = q.eq('occasion', occasion)
  const phone = sp.get('phone'); if (phone) q = q.eq('phone', phone.replace(/\D/g, '').slice(-10))
  const code = sp.get('q'); if (code) q = q.ilike('code', `%${code.trim()}%`)
  // Raw stored status filter (issued/sent/redeemed/void). Derived states
  // (expired/active) are filtered in JS below since they depend on the clock.
  const status = sp.get('status')
  if (status && ['issued', 'sent', 'redeemed', 'void'].includes(status)) q = q.eq('status', status)

  const { data, error } = await q.order('issued_at', { ascending: false }).limit(500)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  let rows = data ?? []
  if (status === 'expired') rows = rows.filter(r => couponState(r) === 'expired')
  if (status === 'active') rows = rows.filter(r => couponState(r) === 'sent')
  return Response.json({ coupons: rows })
}

export async function POST(req: NextRequest) {
  const user = await getRouteUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const b = (await req.json().catch(() => ({}))) as { offerId?: string; recipients?: IssueRecipient[] }
  if (!b.offerId) return Response.json({ error: 'offerId required' }, { status: 400 })
  if (!Array.isArray(b.recipients) || b.recipients.length === 0) {
    return Response.json({ error: 'No recipients' }, { status: 400 })
  }
  const { data: offer } = await supabaseAdmin.from('wa_coupon_offers')
    .select('id, is_active').eq('id', b.offerId).single()
  if (!offer) return Response.json({ error: 'Offer not found' }, { status: 404 })
  if (!offer.is_active) return Response.json({ error: 'That offer is inactive — reactivate it first.' }, { status: 400 })

  const { created, skipped } = await issueCoupons(b.offerId, b.recipients, user.id)
  return Response.json({ created, createdCount: created.length, skipped })
}

export async function PATCH(req: NextRequest) {
  const user = await getRouteUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const id = String(b.id ?? '')
  const action = String(b.action ?? '')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })

  const { data: coupon } = await supabaseAdmin.from('wa_coupons').select('*').eq('id', id).single()
  if (!coupon) return Response.json({ error: 'Coupon not found' }, { status: 404 })

  let patch: Record<string, unknown> = {}
  if (action === 'redeem') {
    if (coupon.status === 'redeemed') return Response.json({ error: 'Already redeemed.' }, { status: 400 })
    if (coupon.status === 'void') return Response.json({ error: 'This coupon is void.' }, { status: 400 })
    patch = {
      status: 'redeemed', redeemed_at: new Date().toISOString(),
      redeemed_by: (b.salesmanId as string) || null,
      redeemed_bill_no: String(b.billNo ?? '').trim() || null,
      redeemed_note: String(b.note ?? '').trim() || null,
    }
  } else if (action === 'void') {
    patch = { status: 'void', notes: String(b.note ?? '').trim() || coupon.notes }
  } else if (action === 'unredeem') {
    // Correct a mistaken redemption — back to 'sent' (active) if still in window, else it reads expired.
    patch = { status: 'sent', redeemed_at: null, redeemed_by: null, redeemed_bill_no: null, redeemed_note: null }
  } else if (action === 'note') {
    patch = { notes: String(b.note ?? '').trim() || null }
  } else {
    return Response.json({ error: 'Unknown action' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin.from('wa_coupons')
    .update(patch).eq('id', id).select('*, offer:wa_coupon_offers(*)').single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ coupon: data })
}
