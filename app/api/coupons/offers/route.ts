import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getRouteUser } from '@/lib/supabase/route'

// Coupon OFFERS — the reusable definitions coupons are cut from.
//   GET                    → all offers (newest first)
//   POST  { ...offer }     → create an offer
//   PATCH { id, ...fields } → edit / toggle-active an offer

export async function GET() {
  const user = await getRouteUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await supabaseAdmin.from('wa_coupon_offers')
    .select('*').order('created_at', { ascending: false })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ offers: data ?? [] })
}

const TYPES = ['making_pct', 'free_gift', 'flat_amount', 'total_pct', 'custom']

export async function POST(req: NextRequest) {
  const user = await getRouteUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const name = String(b.name ?? '').trim()
  const offerText = String(b.offer_text ?? '').trim()
  const discountType = String(b.discount_type ?? 'custom')
  if (!name) return Response.json({ error: 'Offer name is required.' }, { status: 400 })
  if (!offerText) return Response.json({ error: 'Customer-facing offer wording is required.' }, { status: 400 })
  if (!TYPES.includes(discountType)) return Response.json({ error: 'Invalid discount type.' }, { status: 400 })

  const numOrNull = (v: unknown) => (v == null || v === '' ? null : Number(v))
  const { data, error } = await supabaseAdmin.from('wa_coupon_offers').insert({
    name,
    description: String(b.description ?? '').trim() || null,
    discount_type: discountType,
    discount_value: numOrNull(b.discount_value),
    offer_text: offerText,
    min_bill_amount: numOrNull(b.min_bill_amount),
    applies_to: String(b.applies_to ?? 'all'),
    terms: String(b.terms ?? '').trim() || null,
    is_active: b.is_active === undefined ? true : !!b.is_active,
    created_by: user.id,
  }).select('*').single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ offer: data })
}

export async function PATCH(req: NextRequest) {
  const user = await getRouteUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const id = String(b.id ?? '')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })

  const numOrNull = (v: unknown) => (v == null || v === '' ? null : Number(v))
  const patch: Record<string, unknown> = {}
  if (b.name !== undefined) patch.name = String(b.name).trim()
  if (b.description !== undefined) patch.description = String(b.description).trim() || null
  if (b.discount_type !== undefined) {
    if (!TYPES.includes(String(b.discount_type))) return Response.json({ error: 'Invalid discount type.' }, { status: 400 })
    patch.discount_type = b.discount_type
  }
  if (b.discount_value !== undefined) patch.discount_value = numOrNull(b.discount_value)
  if (b.offer_text !== undefined) patch.offer_text = String(b.offer_text).trim()
  if (b.min_bill_amount !== undefined) patch.min_bill_amount = numOrNull(b.min_bill_amount)
  if (b.applies_to !== undefined) patch.applies_to = String(b.applies_to)
  if (b.terms !== undefined) patch.terms = String(b.terms).trim() || null
  if (b.is_active !== undefined) patch.is_active = !!b.is_active
  if (Object.keys(patch).length === 0) return Response.json({ error: 'Nothing to update.' }, { status: 400 })

  const { data, error } = await supabaseAdmin.from('wa_coupon_offers')
    .update(patch).eq('id', id).select('*').single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ offer: data })
}
