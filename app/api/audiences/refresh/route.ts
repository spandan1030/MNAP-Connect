import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { refreshAudienceMembers } from '@/lib/audiences/service'

// Re-materialise an audience's members.  POST { id }
// Dynamic audiences pull in new matches + drop stale ones; fixed audiences that
// were already materialised stay frozen (no-op). This is what the daily run (later)
// will call for every active audience; for now it's manual.

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = (await req.json().catch(() => ({}))) as { id?: string }
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 })

  const r = await refreshAudienceMembers(id)
  if (r.error) return Response.json({ error: r.error }, { status: 400 })
  return Response.json(r)
}
