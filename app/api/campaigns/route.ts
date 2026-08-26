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
  isDynamic: boolean; sentAt: string
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
    .select('id, name, cohort_label, template_name, total, sent, failed, skipped_suppressed, skipped_dnc, is_dynamic, created_at')
    .order('created_at', { ascending: false }).limit(limit)
  const campList = (camps ?? []) as Array<Record<string, unknown>>

  // sent/failed from the SOURCE OF TRUTH — the per-message ledger — rather than the
  // stored counters, which drift when a big send times out after the messages went
  // out but before the counter-update step ran. This makes the list self-healing and
  // agree with the detail view (which already counts from the ledger).
  const campIds = campList.map(c => c.id as string)
  const ledgerSent = new Map<string, number>()
  const ledgerFailed = new Map<string, number>()
  const ledgerSeen = new Set<string>()   // campaigns that HAVE any ledger row
  for (let i = 0; i < campIds.length; i += 100) {
    const slice = campIds.slice(i, i + 100)
    for (let from = 0; ; from += 1000) {
      const { data } = await supabaseAdmin.from('wa_send_ledger')
        .select('campaign_id, status').in('campaign_id', slice).in('status', ['sent', 'failed']).range(from, from + 999)
      const rows = (data ?? []) as { campaign_id: string; status: string }[]
      for (const r of rows) {
        ledgerSeen.add(r.campaign_id)
        const m = r.status === 'sent' ? ledgerSent : ledgerFailed
        m.set(r.campaign_id, (m.get(r.campaign_id) ?? 0) + 1)
      }
      if (rows.length < 1000) break
    }
  }

  for (const c of campList) {
    const id = c.id as string
    // Ledger is authoritative once a campaign has ANY ledger row; fall back to the
    // stored counter only for runs that predate campaign_id stamping (no ledger rows).
    const hasLedger = ledgerSeen.has(id)
    const sent = hasLedger ? (ledgerSent.get(id) ?? 0) : ((c.sent as number) ?? 0)
    const failed = hasLedger ? (ledgerFailed.get(id) ?? 0) : ((c.failed as number) ?? 0)
    const storedTotal = (c.total as number) ?? 0
    out.push({
      id, source: 'reach',
      label: (c.name as string) || (c.cohort_label as string) || 'Reach send', template: (c.template_name as string) ?? null,
      total: Math.max(storedTotal, sent + failed), sent, failed,
      skippedSuppressed: (c.skipped_suppressed as number) ?? 0, skippedDnc: (c.skipped_dnc as number) ?? 0,
      isDynamic: !!c.is_dynamic, sentAt: c.created_at as string,
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
      skippedSuppressed: 0, skippedDnc: 0, isDynamic: false, sentAt: b.created_at as string,
    })
  }

  out.sort((a, b) => (a.sentAt < b.sentAt ? 1 : -1))
  return Response.json({ campaigns: out.slice(0, limit) })
}
