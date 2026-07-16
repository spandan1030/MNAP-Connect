import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'

// Campaigns list — the unified send history: new Reach/thank-you runs
// (wa_campaigns) plus legacy topic broadcasts (wa_broadcasts), newest first.
//   GET /api/campaigns?limit=50

interface CampaignRow {
  id: string; source: 'reach' | 'broadcast'; label: string; template: string | null
  total: number; sent: number; failed: number; skippedSuppressed: number; skippedDnc: number
  sentAt: string
}

export async function GET(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const limit = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') ?? '50') || 50))
  const out: CampaignRow[] = []

  // New unified campaigns (defensive: table may not exist pre-migration).
  const { data: camps } = await supabaseAdmin.from('wa_campaigns')
    .select('id, cohort_label, template_name, total, sent, failed, skipped_suppressed, skipped_dnc, created_at')
    .order('created_at', { ascending: false }).limit(limit)
  for (const c of (camps ?? []) as Array<Record<string, unknown>>) {
    out.push({
      id: c.id as string, source: 'reach',
      label: (c.cohort_label as string) || 'Reach send', template: (c.template_name as string) ?? null,
      total: (c.total as number) ?? 0, sent: (c.sent as number) ?? 0, failed: (c.failed as number) ?? 0,
      skippedSuppressed: (c.skipped_suppressed as number) ?? 0, skippedDnc: (c.skipped_dnc as number) ?? 0,
      sentAt: c.created_at as string,
    })
  }

  // Legacy topic broadcasts.
  const { data: bcs } = await supabaseAdmin.from('wa_broadcasts')
    .select('id, topic_name, template_name, total, sent, failed, created_at')
    .order('created_at', { ascending: false }).limit(limit)
  for (const b of (bcs ?? []) as Array<Record<string, unknown>>) {
    out.push({
      id: b.id as string, source: 'broadcast',
      label: (b.topic_name as string) ? `Broadcast · ${b.topic_name as string}` : 'Broadcast (legacy)',
      template: (b.template_name as string) ?? null,
      total: (b.total as number) ?? 0, sent: (b.sent as number) ?? 0, failed: (b.failed as number) ?? 0,
      skippedSuppressed: 0, skippedDnc: 0, sentAt: b.created_at as string,
    })
  }

  out.sort((a, b) => (a.sentAt < b.sentAt ? 1 : -1))
  return Response.json({ campaigns: out.slice(0, limit) })
}
