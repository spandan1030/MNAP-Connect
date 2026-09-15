import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { refreshAudienceMembers } from '@/lib/audiences/service'

// Re-materialise EVERY active dynamic audience — the "daily run" the single
// refresh route always anticipated. Dynamic audiences freeze their members at
// creation and only re-sync on an explicit refresh; opening Insights or
// activating now refreshes the one you touch, but this keeps the whole library's
// member counts honest without anyone opening each audience.
//
// Auth: either a scheduler bearing CRON_SECRET, or a signed-in user (so it can
// also be triggered by hand). Fixed audiences are skipped by refreshAudienceMembers.

async function authorized(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization')
    if (auth === `Bearer ${secret}`) return true
  }
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  return !!user
}

export async function POST(req: NextRequest) {
  if (!await authorized(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabaseAdmin.from('wa_audiences')
    .select('id').eq('is_dynamic', true).eq('is_active', true)
  const ids = ((data ?? []) as { id: string }[]).map(r => r.id)

  let refreshed = 0, failed = 0
  const results: Array<{ id: string; members?: number; added?: number; removed?: number; error?: string }> = []
  for (const id of ids) {
    const r = await refreshAudienceMembers(id)
    if (r.error) { failed++; results.push({ id, error: r.error }) }
    else { refreshed++; results.push({ id, members: r.members, added: r.added, removed: r.removed }) }
  }

  return Response.json({ total: ids.length, refreshed, failed, results })
}
