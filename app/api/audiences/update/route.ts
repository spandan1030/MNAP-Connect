import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { refreshAudienceMembers } from '@/lib/audiences/service'
import type { ReachFilter } from '@/lib/types'

// Edit a saved audience.  POST { id, name?, description?, filter?, isDynamic?, isActive? }
// Editing the filter (or flipping dynamic) re-snapshots the members from scratch,
// so the materialised list always matches the saved definition.

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    id?: string; name?: string; description?: string; filter?: ReachFilter; isDynamic?: boolean; isActive?: boolean
  }
  if (!body.id) return Response.json({ error: 'Missing id' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) {
    const nm = body.name.trim()
    if (!nm) return Response.json({ error: 'Name cannot be empty.' }, { status: 400 })
    patch.name = nm
  }
  if (body.description !== undefined) patch.description = body.description.trim() || null
  if (body.isActive !== undefined) patch.is_active = !!body.isActive

  const filterChanged = body.filter !== undefined
  const dynamicChanged = body.isDynamic !== undefined
  if (filterChanged) patch.filter = body.filter
  if (dynamicChanged) patch.is_dynamic = !!body.isDynamic && !(body.filter?.phones?.length)

  if (Object.keys(patch).length === 0) return Response.json({ error: 'Nothing to update.' }, { status: 400 })

  const { error } = await supabaseAdmin.from('wa_audiences').update(patch).eq('id', body.id)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  // A changed definition re-snapshots members (force = re-resolve even if fixed).
  let refreshed
  if (filterChanged || dynamicChanged) {
    refreshed = await refreshAudienceMembers(body.id, true)
  }
  return Response.json({ ok: true, refreshed })
}
