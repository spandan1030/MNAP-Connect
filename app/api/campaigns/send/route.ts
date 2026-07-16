import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { resolveCohortPhones, tenDigit } from '@/lib/reach/resolve'
import { dispatchTemplate } from '@/lib/reach/dispatch'
import type { ReachFilter } from '@/lib/types'

// Send the next N of a campaign's members. Members already sent (for this
// campaign) are skipped; a DYNAMIC campaign first pulls in any new matches from
// live data.  POST { campaignId, limit }

async function allMemberPhones(campaignId: string): Promise<string[]> {
  const out: string[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await supabaseAdmin.from('wa_campaign_members')
      .select('phone').eq('campaign_id', campaignId).range(from, from + 999)
    const rows = (data ?? []) as { phone: string }[]
    out.push(...rows.map(r => tenDigit(r.phone)))
    if (rows.length < 1000) break
  }
  return out
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { campaignId, limit } = (await req.json()) as { campaignId?: string; limit?: number }
  if (!campaignId) return Response.json({ error: 'campaignId required' }, { status: 400 })

  const { data: camp } = await supabaseAdmin.from('wa_campaigns')
    .select('id, name, cohort_label, template_id, is_dynamic, filter').eq('id', campaignId).maybeSingle()
  if (!camp) return Response.json({ error: 'Campaign not found' }, { status: 404 })
  if (!camp.template_id) return Response.json({ error: 'This campaign has no template.' }, { status: 400 })

  // Dynamic: pull in new matches before sending.
  let added = 0
  if (camp.is_dynamic && camp.filter) {
    const { phones: set } = await resolveCohortPhones(camp.filter as ReachFilter)
    const fresh = [...set]
    const existing = new Set(await allMemberPhones(campaignId))
    const newOnes = fresh.filter(p => !existing.has(p))
    if (newOnes.length) {
      const names = new Map<string, string>()
      for (let i = 0; i < newOnes.length; i += 300) {
        const { data } = await supabaseAdmin.from('contacts').select('phone, name, name_override').in('phone', newOnes.slice(i, i + 300))
        for (const r of (data ?? []) as Array<{ phone: string; name: string | null; name_override: string | null }>) {
          const nm = (r.name_override || r.name || '').trim(); if (nm && nm !== 'Unknown') names.set(tenDigit(r.phone), nm)
        }
      }
      for (let i = 0; i < newOnes.length; i += 500) {
        const rows = newOnes.slice(i, i + 500).map(p => ({ campaign_id: campaignId, phone: p, name: names.get(p) ?? null }))
        await supabaseAdmin.from('wa_campaign_members').upsert(rows, { onConflict: 'campaign_id,phone' })
      }
      added = newOnes.length
    }
    await supabaseAdmin.from('wa_campaigns').update({ last_refreshed_at: new Date().toISOString() }).eq('id', campaignId)
  }

  // Members not yet sent for THIS campaign (campaign-level dedup, independent of
  // template suppression window).
  const members = await allMemberPhones(campaignId)
  const alreadySent = new Set<string>()
  for (let i = 0; i < members.length; i += 300) {
    const { data } = await supabaseAdmin.from('wa_send_ledger').select('phone')
      .eq('campaign_id', campaignId).eq('status', 'sent').in('phone', members.slice(i, i + 300))
    for (const r of (data ?? []) as { phone: string }[]) alreadySent.add(tenDigit(r.phone))
  }
  const pending = members.filter(p => !alreadySent.has(p))

  const result = await dispatchTemplate({
    templateId: camp.template_id as string,
    recipients: pending.map(p => ({ phone: p })),
    userId: user.id, campaignId,
    cohortLabel: (camp.name as string) || (camp.cohort_label as string) || null,
    limit: limit && limit > 0 ? limit : null,
  })
  if (result.error) return Response.json({ error: result.error }, { status: 400 })

  // Accumulate campaign counts.
  const { data: cur } = await supabaseAdmin.from('wa_campaigns').select('sent, failed').eq('id', campaignId).maybeSingle()
  await supabaseAdmin.from('wa_campaigns').update({
    total: members.length,
    sent: ((cur?.sent as number) ?? 0) + result.sent,
    failed: ((cur?.failed as number) ?? 0) + result.failed,
  }).eq('id', campaignId)

  return Response.json({
    sent: result.sent, failed: result.failed, skippedSuppressed: result.skippedSuppressed,
    skippedDnc: result.skippedDnc, eligibleRemaining: result.eligibleRemaining, added,
  })
}
