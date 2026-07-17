import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { refreshAudienceMembers } from '@/lib/audiences/service'
import { AUDIENCE_CATALOGUE } from '@/lib/audiences/catalogue'

// Seed the pre-made audience catalogue (idempotent — skips presets already seeded
// by name). Materialises each after insert. POST /api/audiences/seed
export async function POST() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Existing seeded names (avoid duplicates on re-run).
  const { data: existing } = await supabaseAdmin.from('wa_audiences').select('name').eq('is_seeded', true)
  const have = new Set((existing ?? []).map((r: { name: string }) => r.name))

  let created = 0
  const errors: string[] = []
  for (const p of AUDIENCE_CATALOGUE) {
    if (have.has(p.name)) continue
    const { data: aud, error } = await supabaseAdmin.from('wa_audiences').insert({
      name: p.name, description: `${p.channel} · ${p.description}`,
      filter: p.filter, is_dynamic: p.dynamic ?? true, is_seeded: true, created_by: user.id,
    }).select('id').single()
    if (error || !aud) { errors.push(`${p.name}: ${error?.message ?? 'insert failed'}`); continue }
    created++
    const r = await refreshAudienceMembers(aud.id as string)
    if (r.error) errors.push(`${p.name}: ${r.error}`)
  }

  return Response.json({ created, skipped: AUDIENCE_CATALOGUE.length - created, errors })
}
