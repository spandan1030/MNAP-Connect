import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getRouteUser } from '@/lib/supabase/route'
import { couponState } from '@/lib/coupons'

// Whose birthday / anniversary falls in a given month (default: this month).
// Powers the birthday/anniversary management module. Each person carries their
// most-recent coupon (any offer) so the UI can show "already sent" at a glance.
//   GET ?month=9  → { month, birthdays:[...], anniversaries:[...] }

interface Person {
  phone: string
  name: string | null
  is_opted_out: boolean
  coupon: { id: string; code: string; state: string; offer_name: string | null; sent_at: string | null } | null
}

export async function GET(req: NextRequest) {
  const user = await getRouteUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const now = new Date()
  const monthRaw = parseInt(req.nextUrl.searchParams.get('month') ?? '', 10)
  const month = monthRaw >= 1 && monthRaw <= 12 ? monthRaw : now.getMonth() + 1

  const [bRes, aRes] = await Promise.all([
    supabaseAdmin.from('contacts').select('phone, name, name_override, is_opted_out')
      .eq('birthday_month', month),
    supabaseAdmin.from('contacts').select('phone, name, name_override, is_opted_out')
      .eq('anniversary_month', month),
  ])

  const allPhones = [...new Set([...(bRes.data ?? []), ...(aRes.data ?? [])].map(r => r.phone))]

  // Latest coupon per phone (any offer) for the "already sent" hint.
  const couponByPhone = new Map<string, Person['coupon']>()
  for (let i = 0; i < allPhones.length; i += 300) {
    const { data } = await supabaseAdmin.from('wa_coupons')
      .select('id, code, phone, status, valid_until, sent_at, issued_at, offer:wa_coupon_offers(name)')
      .in('phone', allPhones.slice(i, i + 300)).order('issued_at', { ascending: false })
    for (const c of (data ?? []) as unknown as Array<{ id: string; code: string; phone: string; status: string; valid_until: string | null; sent_at: string | null; offer: { name: string } | { name: string }[] | null }>) {
      if (couponByPhone.has(c.phone)) continue // first = latest (ordered desc)
      couponByPhone.set(c.phone, {
        id: c.id, code: c.code, state: couponState(c), sent_at: c.sent_at,
        offer_name: (Array.isArray(c.offer) ? c.offer[0]?.name : c.offer?.name) ?? null,
      })
    }
  }

  const toPerson = (r: { phone: string; name: string | null; name_override: string | null; is_opted_out: boolean }): Person => ({
    phone: r.phone,
    name: (r.name_override || r.name || '').trim() || null,
    is_opted_out: r.is_opted_out,
    coupon: couponByPhone.get(r.phone) ?? null,
  })

  return Response.json({
    month,
    birthdays: (bRes.data ?? []).map(toPerson),
    anniversaries: (aRes.data ?? []).map(toPerson),
  })
}
