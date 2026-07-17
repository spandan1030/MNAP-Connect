import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'

// Log a call made from the inbox (or anywhere) — a simple registration with no
// outcome yet (success = null). Ensures a Type-B customer row exists so the log
// always attaches. POST { phone, salesmanId? } -> { ok, customerId }

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

  const body = (await req.json().catch(() => ({}))) as { phone?: string; salesmanId?: string | null }
  const phone = tenDigit(body.phone ?? '')
  if (phone.length !== 10) return Response.json({ error: 'Invalid phone' }, { status: 400 })

  // Find or create a minimal Type-B customer for this phone.
  const { data: existing } = await supabaseAdmin.from('wa_b_customers').select('id').eq('phone', phone).maybeSingle()
  let customerId = existing?.id as string | undefined
  if (!customerId) {
    // Borrow a display name from the contact spine if we have one.
    const { data: ct } = await supabaseAdmin.from('contacts').select('name, name_override').eq('phone', phone).maybeSingle()
    const nm = ((ct?.name_override || ct?.name || '') as string).trim() || `Contact ${phone.slice(-4)}`
    const { data: cust, error } = await supabaseAdmin.from('wa_b_customers')
      .insert({ name: nm, phone, enrolled_by: user.id, source: 'chat' }).select('id').single()
    if (error || !cust) return Response.json({ error: error?.message ?? 'Could not create customer.' }, { status: 500 })
    customerId = cust.id as string
  }

  const { error: lErr } = await supabaseAdmin.from('wa_b_call_logs').insert({
    customer_id: customerId, called_by: user.id,
    salesman_id: body.salesmanId || null, success: null,
  })
  if (lErr) return Response.json({ error: lErr.message }, { status: 500 })

  return Response.json({ ok: true, customerId })
}
