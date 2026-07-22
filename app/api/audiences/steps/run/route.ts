import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { runStep } from '@/lib/audiences/steps'

// Run one step: carry from the previous step, narrow, then send / call.
//   POST /api/audiences/steps/run  { stepId }
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

  const result = await runStep(stepId, user.id)
  if (result.error) return Response.json({ error: result.error }, { status: 400 })
  return Response.json(result)
}
