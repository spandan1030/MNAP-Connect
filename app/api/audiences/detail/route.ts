import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'

// Audience detail.  GET /api/audiences/detail?id=<uuid>[&withMembers=1]
// Returns the saved definition + optionally the first 1000 materialised members.

export async function GET(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 })

  const { data: audience, error } = await supabaseAdmin.from('wa_audiences')
    .select('id, name, description, filter, is_dynamic, is_active, is_seeded, member_count, last_refreshed_at, created_at')
    .eq('id', id).maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!audience) return Response.json({ error: 'Audience not found' }, { status: 404 })

  let members: Array<{ phone: string; name: string | null }> | undefined
  if (req.nextUrl.searchParams.get('withMembers')) {
    const { data } = await supabaseAdmin.from('audience_members')
      .select('phone, name').eq('audience_id', id).order('added_at', { ascending: false }).range(0, 999)
    members = (data ?? []) as Array<{ phone: string; name: string | null }>
  }

  return Response.json({ audience, members })
}
