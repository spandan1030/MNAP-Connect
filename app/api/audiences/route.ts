import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { refreshAudienceMembers } from '@/lib/audiences/service'
import type { ReachFilter } from '@/lib/types'

// Audience library.
//   GET  /api/audiences            -> list all saved audiences
//   POST /api/audiences            -> create { name, description?, filter, isDynamic }
//                                     resolves + materialises members immediately.

async function auth() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function GET() {
  if (!await auth()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await supabaseAdmin.from('wa_audiences')
    .select('id, name, description, is_dynamic, is_active, is_seeded, member_count, last_refreshed_at, created_at')
    .order('created_at', { ascending: false })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ audiences: data ?? [] })
}

export async function POST(req: NextRequest) {
  const user = await auth()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { name, description, filter, isDynamic } = (await req.json().catch(() => ({}))) as {
    name?: string; description?: string; filter?: ReachFilter; isDynamic?: boolean
  }
  const nm = (name ?? '').trim()
  if (!nm) return Response.json({ error: 'Give the audience a name.' }, { status: 400 })
  const f: ReachFilter = filter ?? {}
  // A pasted phone list can only be a fixed snapshot.
  const dynamic = !!isDynamic && !(f.phones?.length)

  const { data: aud, error } = await supabaseAdmin.from('wa_audiences').insert({
    name: nm, description: (description ?? '').trim() || null,
    filter: f, is_dynamic: dynamic, created_by: user.id,
  }).select('id').single()
  if (error || !aud) return Response.json({ error: error?.message ?? 'Could not create audience.' }, { status: 500 })

  const r = await refreshAudienceMembers(aud.id as string)
  if (r.error) return Response.json({ id: aud.id, members: 0, warning: r.error })
  return Response.json({ id: aud.id, members: r.members, dynamic })
}
