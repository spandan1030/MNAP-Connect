import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getRouteUser } from '@/lib/supabase/route'
import { couponState } from '@/lib/coupons'

// Counter validation — "is this code good, and whose is it?"
//   GET ?code=MNAP-7F4K2  → the coupon + offer + derived state (case-insensitive)
export async function GET(req: NextRequest) {
  const user = await getRouteUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const code = (req.nextUrl.searchParams.get('code') ?? '').trim()
  if (!code) return Response.json({ error: 'code required' }, { status: 400 })

  const { data, error } = await supabaseAdmin.from('wa_coupons')
    .select('*, offer:wa_coupon_offers(*)').ilike('code', code).maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ found: false })
  return Response.json({ found: true, coupon: data, state: couponState(data) })
}
