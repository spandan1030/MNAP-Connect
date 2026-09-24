import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'

// Record the outcome of a call logged from the inbox/chat. The call row was
// created (success=null) when "Call" was tapped; the salesman fills the result
// when they come back. PATCH { logId, success, notes? } -> { ok }
//   success true  = reached, false = no answer.

export async function PATCH(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { logId?: string; success?: boolean; notes?: string }
  if (!body.logId) return Response.json({ error: 'Missing logId' }, { status: 400 })

  const { error } = await supabaseAdmin.from('wa_b_call_logs').update({
    success: body.success ?? null,
    notes: (body.notes ?? '').trim() || null,
    outcome_at: new Date().toISOString(),
  }).eq('id', body.logId)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true })
}
