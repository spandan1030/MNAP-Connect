import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'

// Opt a contact IN or OUT of all communication (WhatsApp + calls; ads unaffected).
// The single lever is set_opt_out() (wa_049): opting IN (value=false) force-clears
// is_opted_out AND all three provenance flags (chat STOP / call DNC / manual), so a
// customer who said "you can message me again" is truly re-enabled — which a bare
// manual-flag toggle could NOT do. Returns the re-read flag.
//   POST { phone, optOut } -> { ok, isOptedOut }

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

  const body = (await req.json().catch(() => ({}))) as { phone?: string; optOut?: boolean }
  const phone = tenDigit(body.phone ?? '')
  if (phone.length !== 10) return Response.json({ error: 'Invalid phone' }, { status: 400 })
  const value = body.optOut === true

  const { error } = await supabaseAdmin.rpc('set_opt_out', { target_phone: phone, value, reason: 'manual' })
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const { data } = await supabaseAdmin.from('contacts').select('is_opted_out').eq('phone', phone).maybeSingle()
  return Response.json({ ok: true, isOptedOut: (data?.is_opted_out as boolean | undefined) ?? value })
}
