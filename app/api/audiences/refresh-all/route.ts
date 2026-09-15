import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { refreshAudienceMembers } from '@/lib/audiences/service'

// Re-materialise every active DYNAMIC audience in one sweep — behind the
// "Refresh all" button on /audiences. Dynamic audiences freeze their members at
// creation; opening Insights or activating refreshes the one you touch, this
// brings the whole list's member counts current at once. Fixed audiences are a
// no-op (refreshAudienceMembers keeps them frozen).

export const maxDuration = 60

export async function POST() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabaseAdmin.from('wa_audiences')
    .select('id').eq('is_dynamic', true).eq('is_active', true)
  const ids = ((data ?? []) as { id: string }[]).map(r => r.id)

  let refreshed = 0, failed = 0
  for (const id of ids) {
    const r = await refreshAudienceMembers(id)
    if (r.error) failed++; else refreshed++
  }

  return Response.json({ total: ids.length, refreshed, failed })
}
