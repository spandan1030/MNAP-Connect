import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'

// Delete a DRAFT step. A run step is history (it sent / called) — it can't be
// deleted, and only the last step can be removed so the sequence stays contiguous.
//   POST /api/audiences/steps/delete  { stepId }
export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { stepId } = (await req.json().catch(() => ({}))) as { stepId?: string }
  if (!stepId) return Response.json({ error: 'Missing stepId' }, { status: 400 })

  const { data: step } = await supabaseAdmin.from('audience_steps')
    .select('id, audience_id, seq, status').eq('id', stepId).maybeSingle()
  if (!step) return Response.json({ error: 'Step not found' }, { status: 404 })
  if (step.status === 'run') return Response.json({ error: 'A step that already ran cannot be deleted.' }, { status: 400 })

  const { data: last } = await supabaseAdmin.from('audience_steps')
    .select('seq').eq('audience_id', step.audience_id).order('seq', { ascending: false }).limit(1).maybeSingle()
  if ((last?.seq as number) !== step.seq) {
    return Response.json({ error: 'Only the last step can be removed.' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('audience_steps').delete().eq('id', stepId)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
