import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'

// Export the unified interest layer for the customer-signals pipeline.
// One row per (phone, interest, source). The pipeline joins by phone and
// builds interest-based Meta/Google audiences.
//   GET /api/signals/export -> signals_export.csv

function csvCell(v: unknown): string {
  if (v == null) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function GET(_req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const header = ['phone', 'interest', 'source', 'weight', 'last_seen']
  const lines = [header.join(',')]

  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('wa_signals')
      .select('phone,interest,source,weight,last_seen')
      .order('phone', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    const rows = (data ?? []) as Record<string, unknown>[]
    for (const r of rows) lines.push(header.map(h => csvCell(r[h])).join(','))
    if (rows.length < PAGE) break
  }

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="signals_export.csv"',
    },
  })
}
