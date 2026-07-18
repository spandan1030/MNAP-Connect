import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'

// Non-destructively adopt the CURRENT live calling cohort into an audience — the
// lapsed-winback wrap. Links the existing wa_b_call_campaign (its tasks + call
// history + DNC status intact) to this audience, so activating the audience on
// calling reuses that same campaign (nobody re-called). POST { audienceId }
export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { audienceId } = (await req.json().catch(() => ({}))) as { audienceId?: string }
  if (!audienceId) return Response.json({ error: 'Missing audienceId' }, { status: 400 })

  // The single live calling cohort (Call Control keeps only one active).
  const { data: live } = await supabaseAdmin.from('wa_b_call_campaigns')
    .select('id, name, audience_id').eq('is_active', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!live) return Response.json({ error: 'No live calling cohort to adopt.' }, { status: 400 })
  if (live.audience_id) return Response.json({ error: 'The live calling cohort is already linked to an audience.' }, { status: 400 })

  const { error } = await supabaseAdmin.from('wa_b_call_campaigns')
    .update({ audience_id: audienceId }).eq('id', live.id)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true, adopted: live.name })
}
