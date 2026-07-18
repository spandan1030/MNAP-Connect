import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { AUDIENCE_CATALOGUE } from '@/lib/audiences/catalogue'

// Seed the pre-made audience catalogue. Insert-only + idempotent: each row carries
// a stable seed_key (UNIQUE), so re-clicking or two concurrent requests can never
// duplicate (ON CONFLICT DO NOTHING). It does NOT materialise members here — that's
// heavy (21 cohort resolves) and would time out; the client refreshes each audience
// afterwards, one request at a time. POST /api/audiences/seed
export async function POST() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = AUDIENCE_CATALOGUE.map(p => ({
    seed_key: p.key, name: p.name, description: `${p.channel} · ${p.description}`,
    filter: p.filter, is_dynamic: p.dynamic ?? true, is_seeded: true, created_by: user.id,
  }))

  // One upsert; the UNIQUE(seed_key) index makes it a no-op for rows already present.
  const { error } = await supabaseAdmin.from('wa_audiences')
    .upsert(rows, { onConflict: 'seed_key', ignoreDuplicates: true })
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const { count } = await supabaseAdmin.from('wa_audiences')
    .select('id', { count: 'exact', head: true }).eq('is_seeded', true)
  return Response.json({ ok: true, seeded: count ?? rows.length })
}
